import { randomBytes } from "node:crypto";
import { DomainError } from "../errors.js";
import { sha256Hex, newId, collectionReference, payoutReference, deliveryCode, deliveryCodeMatches, randomToken } from "../ids.js";
import { hashPassword, verifyPassword, signJwt, verifyJwt, signTradeToken, readTradeToken } from "../auth.js";
import { normalizePhone, payoutNarration } from "../phone.js";
import { payazaNumberToMinor, type Currency } from "../money.js";
import { minorToPayazaNumber } from "../money.js";
import { issueQuote, assertQuoteLive, assertSettlementAvailable, assertExposureAllows, assertTreasuryEvidence, type RateObservation } from "../fx.js";
import { transition, type TradeCommand, type PayoutIntent } from "../escrow.js";
import { decideCollection } from "../collectionDecision.js";
import {
  journalCollection,
  journalKesObligation,
  journalPayout,
  journalRefundPayout,
  journalTreasuryConversion,
  openExposureKes,
  reconcile,
  type AccountBalance,
  type LedgerAccount,
} from "../ledger.js";
import { assertCanPayout, lockPayoutMethod, nextStatusAfterOtpSend, nextStatusAfterOtpVerify } from "../verification.js";
import { assertInvoiceAllowed, assertPayoutAllowed, duplicateInvoice } from "../risk.js";
import { availableActions, isDisputeWindow } from "../actions.js";
import { corridorById, corridorForBuyerCurrency, assertCollectionNetwork } from "../corridors.js";
import { paymentQrText } from "../qr.js";
import { escrowFingerprint, issueNfcToken, readNfcToken } from "../nfc.js";
import { scoreTradeRecords } from "../credit.js";
import { renderTemplate, type Language } from "../templates.js";
import { FUNDS_HOLDING } from "../fundsHolding.js";
import { buildCapabilities, type VerificationLog } from "../capabilities.js";
import type {
  BusinessRecord,
  CollectionRecord,
  InvoiceRecord,
  Notifier,
  PayoutMethodRecord,
  PayoutRecord,
  Rails,
  Repository,
  ServiceConfig,
  TradeRecord,
  UserRecord,
} from "./repository.js";

export interface ServiceDeps {
  repo: Repository;
  rails: Rails;
  notifier: Notifier;
  config: ServiceConfig;
  now?: () => Date;
  verification?: VerificationLog;
  fxProbeOk?: boolean;
  fxProbe?: () => Promise<boolean>;
}

export class VukaService {
  constructor(private readonly deps: ServiceDeps) {}

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }

  async capabilities() {
    const flags = await this.deps.repo.flags();
    return buildCapabilities({
      tenant: this.deps.config.tenant,
      verification: this.deps.verification ?? {},
      fxQuoteProbeOk: this.deps.fxProbe ? await this.deps.fxProbe() : (this.deps.fxProbeOk ?? false),
      settlementMode: flags["fx.settlement.treasury_float"] ? "treasury_float" : this.deps.config.settlementMode,
      smsConfigured: this.deps.config.smsConfigured,
      emailConfigured: false,
      whatsappConfigured: false,
      voiceConfigured: false,
      creditEnabled: this.deps.config.creditEnabled || flags["credit.enabled"] === true,
      collectionNetworks: this.deps.config.collectionNetworks,
    });
  }

  fundsHolding(language: Language) {
    return { statement: FUNDS_HOLDING[language] };
  }

  async register(input: { email: string; password: string; displayName: string; language: Language }) {
    if (input.password.length < 10) {
      throw new DomainError("VALIDATION_FAILED", "Password must be at least 10 characters", 422);
    }
    const existing = await this.deps.repo.userByEmail(input.email.toLowerCase());
    if (existing) throw new DomainError("CONFLICT", "Email is already registered", 409);
    const user: UserRecord = {
      id: newId("usr"),
      email: input.email.toLowerCase(),
      passwordHash: await hashPassword(input.password),
      role: "EXPORTER",
      displayName: input.displayName,
      phone: null,
      language: input.language,
      createdAt: this.now().toISOString(),
    };
    const business: BusinessRecord = {
      id: newId("biz"),
      userId: user.id,
      legalName: input.displayName,
      tradingName: input.displayName,
      country: "KE",
      kycTier: "NONE",
      nationalIdNumber: null,
      kraPin: null,
    };
    await this.deps.repo.transaction(async (repo) => {
      await repo.saveUser(user);
      await repo.saveBusiness(business);
    });
    return this.tokens(user);
  }

  async login(input: { email: string; password: string }) {
    const user = await this.deps.repo.userByEmail(input.email.toLowerCase());
    if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
      throw new DomainError("UNAUTHENTICATED", "Email or password is wrong", 401);
    }
    return this.tokens(user);
  }

  async refresh(refreshToken: string) {
    const payload = this.readRefresh(refreshToken);
    const row = await this.deps.repo.refreshByHash(sha256Hex(refreshToken));
    if (!row || row.revokedAt || row.userId !== payload.sub) {
      throw new DomainError("UNAUTHENTICATED", "Refresh token is not active", 401);
    }
    const user = await this.deps.repo.userById(row.userId);
    if (!user) throw new DomainError("UNAUTHENTICATED", "User no longer exists", 401);
    row.revokedAt = this.now().toISOString();
    await this.deps.repo.saveRefresh(row);
    return this.tokens(user);
  }

  async logout(refreshToken: string) {
    const row = await this.deps.repo.refreshByHash(sha256Hex(refreshToken));
    if (row) {
      row.revokedAt = this.now().toISOString();
      await this.deps.repo.saveRefresh(row);
    }
  }

  async me(userId: string) {
    const user = await this.requireUser(userId);
    const business = await this.deps.repo.businessByUser(userId);
    return {
      id: user.id,
      email: user.email,
      display_name: user.displayName,
      role: user.role,
      language: user.language,
      business: business
        ? {
            id: business.id,
            legal_name: business.legalName,
            trading_name: business.tradingName,
            country: business.country,
            kyc_tier: business.kycTier,
          }
        : null,
    };
  }

  async updateMe(userId: string, patch: { displayName?: string; phone?: string; language?: Language }) {
    const user = await this.requireUser(userId);
    if (patch.displayName) user.displayName = patch.displayName;
    if (patch.language) user.language = patch.language;
    if (patch.phone) user.phone = normalizePhone(patch.phone, "KE");
    await this.deps.repo.saveUser(user);
    return this.me(userId);
  }

  async updateBusiness(userId: string, input: { legalName: string; tradingName: string; nationalIdNumber?: string; kraPin?: string; kycTier?: BusinessRecord["kycTier"] }) {
    const business = await this.requireBusiness(userId);
    business.legalName = input.legalName;
    business.tradingName = input.tradingName;
    if (input.nationalIdNumber) {
      business.nationalIdNumber = input.nationalIdNumber;
      if (business.kycTier === "NONE") business.kycTier = "BASIC";
    }
    if (input.kraPin) {
      business.kraPin = input.kraPin;
      business.kycTier = "BUSINESS";
    }
    if (input.kycTier && userIsAdmin(await this.requireUser(userId))) business.kycTier = input.kycTier;
    await this.deps.repo.saveBusiness(business);
    return this.me(userId);
  }

  async addPayoutMethod(userId: string, input: { phone: string; accountName: string }) {
    const business = await this.requireBusiness(userId);
    const phone = normalizePhone(input.phone, "KE");
    const row: PayoutMethodRecord = {
      id: newId("pom"),
      businessId: business.id,
      currency: "KES",
      phone,
      accountName: input.accountName,
      status: "UNVERIFIED",
      lockedTradeId: null,
      coolingOffUntil: null,
      verifiedAt: null,
      otpHash: null,
      otpExpiresAt: null,
    };
    await this.deps.repo.savePayoutMethod(row);
    return payoutView(row);
  }

  async sendPayoutOtp(userId: string, methodId: string, language: Language) {
    if (!this.deps.config.smsConfigured) {
      throw new DomainError("CAPABILITY_GATED", "SMS is not configured, so payout OTP cannot be sent", 409);
    }
    const business = await this.requireBusiness(userId);
    const method = await this.requireMethod(business.id, methodId);
    const code = (randomBytes(3).readUIntBE(0, 3) % 1_000_000).toString().padStart(6, "0");
    method.status = nextStatusAfterOtpSend(method.status);
    method.otpHash = sha256Hex(`otp:${code}`);
    method.otpExpiresAt = new Date(this.now().getTime() + 10 * 60_000).toISOString();
    await this.deps.notifier.sms(method.phone, renderTemplate(language, "otp", { code }));
    await this.deps.repo.savePayoutMethod(method);
    await this.deps.repo.saveNotification({
      id: newId("ntf"),
      channel: "sms",
      toMasked: maskPhone(method.phone),
      template: "otp",
      status: "SENT",
    });
    return payoutView(method);
  }

  async verifyPayoutOtp(userId: string, methodId: string, code: string) {
    const business = await this.requireBusiness(userId);
    const method = await this.requireMethod(business.id, methodId);
    if (!method.otpHash || !method.otpExpiresAt || this.now().toISOString() > method.otpExpiresAt) {
      throw new DomainError("VALIDATION_FAILED", "OTP has expired", 422);
    }
    if (sha256Hex(`otp:${code}`) !== method.otpHash) {
      throw new DomainError("VALIDATION_FAILED", "OTP does not match", 422);
    }
    method.status = nextStatusAfterOtpVerify(method.status);
    method.verifiedAt = this.now().toISOString();
    method.otpHash = null;
    method.coolingOffUntil = null;
    await this.deps.repo.savePayoutMethod(method);
    return payoutView(method);
  }

  async listPayoutMethods(userId: string) {
    const business = await this.requireBusiness(userId);
    return (await this.deps.repo.payoutMethods(business.id)).map(payoutView);
  }

  async deletePayoutMethod(userId: string, methodId: string) {
    const business = await this.requireBusiness(userId);
    const method = await this.requireMethod(business.id, methodId);
    if (method.lockedTradeId) throw new DomainError("CONFLICT", "Payout number is locked to a trade", 409);
    method.status = "COOLING_OFF";
    method.coolingOffUntil = new Date(this.now().getTime() + this.deps.config.coolingSeconds * 1000).toISOString();
    method.verifiedAt = null;
    await this.deps.repo.savePayoutMethod(method);
    return payoutView(method);
  }

  async createInvoice(userId: string, input: {
    items: { description: string; quantity: number; unitMinor: bigint }[];
    buyer: { name: string; phone: string; country: "UG" | "TZ" | "RW"; network?: string; currency: "UGX" | "TZS" | "RWF" };
    notes?: string;
    shippingDeadline?: string;
    disputeWindowHours?: number;
    observations: RateObservation[];
    partnershipId?: string;
  }) {
    const business = await this.requireBusiness(userId);
    const corridor = corridorForBuyerCurrency(input.buyer.currency);
    if (input.buyer.country !== corridor.buyerCountry) {
      throw new DomainError("VALIDATION_FAILED", "Buyer country does not match the currency corridor", 422);
    }
    if (input.disputeWindowHours != null && !isDisputeWindow(input.disputeWindowHours)) {
      throw new DomainError("VALIDATION_FAILED", "Dispute window must be 24, 48, or 72 hours", 422);
    }
    const phone = normalizePhone(input.buyer.phone, corridor.buyerCountry);
    const itemsMinor = input.items.reduce((sum, item) => sum + BigInt(item.quantity) * item.unitMinor, 0n);
    await assertInvoiceAllowed(itemsMinor, {
      maxInvoiceKesMinor: this.deps.config.maxInvoiceKesMinor,
      firstPayoutKesMinor: this.deps.config.firstPayoutKesMinor,
      maxPayoutsPerDay: this.deps.config.maxPayoutsPerDay,
      kycTier: business.kycTier,
    }, {
      priorPayoutCount: await this.deps.repo.succeededPayoutCount(business.id),
      payoutsToday: 0,
      openInvoiceKesMinor: await this.deps.repo.openInvoiceMinor(business.id),
    });
    const day = this.now().toISOString().slice(0, 10);
    const fingerprint = sha256Hex(`${business.id}|${phone}|${itemsMinor}|${day}`);
    duplicateInvoice({ existingFingerprints: await this.deps.repo.fingerprints(business.id), fingerprint });
    this.assertSettlementForNewTrade();
    const exposure = openExposureKes(await this.asBalances());
    const quote = issueQuote({
      itemsMinor,
      to: input.buyer.currency,
      observations: input.observations,
      now: this.now(),
      config: {
        spreadBps: this.deps.config.spreadBps,
        ttlSeconds: this.deps.config.quoteTtlSeconds,
        maxDeviationBps: this.deps.config.maxDeviationBps,
        maxRateAgeSeconds: this.deps.config.maxRateAgeSeconds,
        fee: {
          bps: this.deps.config.feeBps,
          minMinor: this.deps.config.feeMinMinor,
          maxMinor: this.deps.config.feeMaxMinor,
        },
      },
    });
    assertExposureAllows({
      openExposureMinor: exposure,
      additionalMinor: quote.exporterNetKesMinor + quote.feeMinor,
      maxOpenExposureMinor: this.deps.config.maxOpenExposureMinor,
    });
    const invoice: InvoiceRecord = {
      id: newId("inv"),
      businessId: business.id,
      status: "DRAFT",
      corridorId: corridor.id,
      buyerName: input.buyer.name,
      buyerPhone: phone,
      buyerCountry: input.buyer.country,
      networkCode: input.buyer.network ?? null,
      currency: input.buyer.currency,
      itemsMinor: quote.itemsMinor,
      feeMinor: quote.feeMinor,
      exporterNetMinor: quote.exporterNetKesMinor,
      buyerAmountMinor: quote.buyerAmountMinor,
      midRate: quote.midRate,
      spreadBps: quote.spreadBps,
      quoteExpiresAt: quote.expiresAt.toISOString(),
      quoteSources: quote.sources,
      notes: input.notes ?? null,
      shippingDeadline: input.shippingDeadline ?? null,
      disputeWindowHours: input.disputeWindowHours ?? null,
      fingerprint,
      partnershipId: input.partnershipId ?? null,
      items: input.items.map((item) => ({ ...item, id: newId("itm") })),
      createdAt: this.now().toISOString(),
    };
    await this.deps.repo.saveInvoice(invoice);
    return invoiceView(invoice);
  }

  async sendInvoice(userId: string, invoiceId: string, language: Language) {
    const business = await this.requireBusiness(userId);
    const invoice = await this.requireInvoice(business.id, invoiceId);
    if (invoice.status !== "DRAFT") throw new DomainError("CONFLICT", "Invoice is not a draft", 409);
    assertQuoteLive(new Date(invoice.quoteExpiresAt), this.now());
    const methods = await this.deps.repo.payoutMethods(business.id);
    const method = methods.find((row) => row.status === "VERIFIED" || row.status === "LOCKED");
    if (!method) throw new DomainError("RECIPIENT_NOT_VERIFIED", "Add and verify an M-Pesa payout number first", 409);
    assertCanPayout(
      {
        id: method.id,
        currency: method.currency,
        phone: method.phone,
        status: method.status,
        lockedTradeId: method.lockedTradeId,
        coolingOffUntil: method.coolingOffUntil ? new Date(method.coolingOffUntil) : null,
        verifiedAt: method.verifiedAt ? new Date(method.verifiedAt) : null,
      },
      this.now(),
    );
    const trade = this.newTrade(invoice, method.id);
    const event = transition("DRAFT", {
      command: "ISSUE",
      actor: userId,
      reason: "invoice sent",
      now: this.now(),
    });
    trade.state = event.toState;
    const locked = lockPayoutMethod(
      {
        id: method.id,
        currency: method.currency,
        phone: method.phone,
        status: method.status,
        lockedTradeId: method.lockedTradeId,
        coolingOffUntil: method.coolingOffUntil ? new Date(method.coolingOffUntil) : null,
        verifiedAt: method.verifiedAt ? new Date(method.verifiedAt) : null,
      },
      trade.id,
    );
    method.status = locked.status;
    method.lockedTradeId = locked.lockedTradeId;
    invoice.status = "INVOICED";
    const link = this.buyerLink(trade.id);
    await this.deps.repo.transaction(async (repo) => {
      await repo.saveTrade(trade);
      await repo.appendEvent(this.eventRow(trade.id, event));
      await repo.saveInvoice(invoice);
      await repo.savePayoutMethod(method);
    });
    if (this.deps.config.smsConfigured) {
      await this.deps.notifier.sms(
        invoice.buyerPhone,
        renderTemplate(language, "invoice_sent", { exporter: business.tradingName, link: link.url }),
      );
    }
    return { invoice: invoiceView(invoice), trade: await this.tradeView(trade.id), pay_url: link.url };
  }

  async cancelInvoice(userId: string, invoiceId: string) {
    const business = await this.requireBusiness(userId);
    const invoice = await this.requireInvoice(business.id, invoiceId);
    const trade = await this.deps.repo.tradeByInvoice(invoice.id);
    if (!trade) {
      invoice.status = "CANCELLED";
      await this.deps.repo.saveInvoice(invoice);
      return invoiceView(invoice);
    }
    const event = transition(trade.state, { command: "CANCEL", actor: userId, reason: "cancelled", now: this.now() });
    trade.state = event.toState;
    trade.updatedAt = this.now().toISOString();
    invoice.status = "CANCELLED";
    await this.deps.repo.transaction(async (repo) => {
      await repo.saveTrade(trade);
      await repo.appendEvent(this.eventRow(trade.id, event));
      await repo.saveInvoice(invoice);
      await this.writeRecord(repo, trade, false, null);
    });
    return invoiceView(invoice);
  }

  async listInvoices(userId: string) {
    const business = await this.requireBusiness(userId);
    return (await this.deps.repo.invoices(business.id)).map(invoiceView);
  }

  async getInvoice(userId: string, invoiceId: string) {
    const business = await this.requireBusiness(userId);
    return invoiceView(await this.requireInvoice(business.id, invoiceId));
  }

  async listTrades(userId: string) {
    const business = await this.requireBusiness(userId);
    const rows = await this.deps.repo.trades({ businessId: business.id });
    return Promise.all(rows.map((row) => this.tradeView(row.id)));
  }

  async getTrade(userId: string, tradeId: string) {
    const business = await this.requireBusiness(userId);
    const trade = await this.requireTrade(tradeId);
    if (trade.businessId !== business.id) throw new DomainError("NOT_FOUND", "Trade not found", 404);
    return this.tradeView(tradeId);
  }

  buyerView(token: string) {
    return this.withBuyer(token, async (trade) => this.tradeView(trade.id, "buyer"));
  }

  async refreshBuyerQuote(token: string, observations: RateObservation[]) {
    const { tradeId } = this.parseBuyer(token);
    const trade = await this.requireTrade(tradeId);
    const invoice = await this.deps.repo.invoice(trade.invoiceId);
    if (!invoice) throw new DomainError("NOT_FOUND", "Invoice not found", 404);
    if (trade.state !== "INVOICED" && trade.state !== "AWAITING_PAYMENT" && trade.state !== "EXPIRED" && trade.state !== "PAYMENT_FAILED") {
      throw new DomainError("CONFLICT", "Quote can no longer be refreshed", 409);
    }
    const quote = issueQuote({
      itemsMinor: trade.itemsMinor,
      to: trade.buyerCurrency === "TZS" ? "TZS" : "UGX",
      observations,
      now: this.now(),
      config: {
        spreadBps: this.deps.config.spreadBps,
        ttlSeconds: this.deps.config.quoteTtlSeconds,
        maxDeviationBps: this.deps.config.maxDeviationBps,
        maxRateAgeSeconds: this.deps.config.maxRateAgeSeconds,
        fee: { bps: this.deps.config.feeBps, minMinor: this.deps.config.feeMinMinor, maxMinor: this.deps.config.feeMaxMinor },
      },
    });
    trade.quotedBuyerMinor = quote.buyerAmountMinor;
    trade.exporterNetMinor = quote.exporterNetKesMinor;
    trade.feeMinor = quote.feeMinor;
    trade.quoteExpiresAt = quote.expiresAt.toISOString();
    invoice.buyerAmountMinor = quote.buyerAmountMinor;
    invoice.exporterNetMinor = quote.exporterNetKesMinor;
    invoice.feeMinor = quote.feeMinor;
    invoice.midRate = quote.midRate;
    invoice.quoteExpiresAt = quote.expiresAt.toISOString();
    invoice.quoteSources = quote.sources;
    await this.deps.repo.saveTrade(trade);
    await this.deps.repo.saveInvoice(invoice);
    return this.tradeView(trade.id, "buyer");
  }

  async openBuyer(token: string) {
    const { tradeId } = this.parseBuyer(token);
    const trade = await this.requireTrade(tradeId);
    if (trade.state === "INVOICED") {
      await this.move(trade, "BUYER_OPENED", "buyer", "link opened");
    }
    return this.tradeView(trade.id, "buyer");
  }

  async collect(token: string, input: { phone: string; networkCode: string }) {
    const { tradeId } = this.parseBuyer(token);
    const trade = await this.requireTrade(tradeId);
    if (trade.state === "INVOICED") await this.move(trade, "BUYER_OPENED", "buyer", "link opened");
    const current = await this.requireTrade(trade.id);
    assertQuoteLive(new Date(current.quoteExpiresAt), this.now());
    const corridor = corridorById(current.corridorId);
    const network = assertCollectionNetwork(this.deps.config.collectionNetworks, current.buyerCurrency, input.networkCode);
    const phone = normalizePhone(input.phone, corridor.buyerCountry);
    if (current.state !== "AWAITING_PAYMENT" && current.state !== "PAYMENT_FAILED" && current.state !== "EXPIRED") {
      throw new DomainError("ILLEGAL_STATE_TRANSITION", `Collection cannot start from ${current.state}`, 409);
    }
    if (current.state === "PAYMENT_FAILED" || current.state === "EXPIRED") {
      await this.move(current, "RETRY", "buyer", "new collection reference", {
        attemptCount: current.attemptCount,
        invoiceDeadline: new Date(current.invoiceDeadline),
      });
    }
    const fresh = await this.requireTrade(trade.id);
    const reference = collectionReference(corridor.code);
    const collection: CollectionRecord = {
      id: newId("col"),
      tradeId: fresh.id,
      transactionReference: reference,
      networkCode: network.code,
      phone,
      status: "INITIATED",
      amountMinor: fresh.quotedBuyerMinor - fresh.heldBuyerMinor,
      currency: fresh.buyerCurrency,
      rawResponse: null,
    };
    await this.deps.repo.saveCollection(collection);
    const [first, ...rest] = fresh.buyerName.split(" ");
    const response = await this.deps.rails.processCollection({
      amount: minorToPayazaNumber(collection.amountMinor, fresh.buyerCurrency),
      customer_number: phone,
      transaction_reference: reference,
      transaction_description: payoutNarration(`VukaPay ${fresh.id}`),
      customer_bank_code: network.code,
      currency_code: fresh.buyerCurrency,
      customer_email: "buyer@vukapay.local",
      customer_first_name: first || "Buyer",
      customer_last_name: rest.join(" ") || "Buyer",
      customer_phone_number: phone,
      country_code: corridor.buyerCountry,
    });
    if (response.response_code !== "09") {
      collection.status = "FAILED";
      collection.rawResponse = response;
      await this.deps.repo.saveCollection(collection);
      throw new DomainError("PAYMENT_PROMPT_FAILED", "Payaza did not accept the collection prompt", 502, {
        response_code: response.response_code,
      });
    }
    collection.status = "PENDING";
    collection.rawResponse = response;
    fresh.attemptCount += 1;
    await this.deps.repo.saveCollection(collection);
    if (fresh.state === "AWAITING_PAYMENT") {
      await this.move(fresh, "PROMPT_SENT", "buyer", "prompt sent");
    }
    const checkoutUrl = response.payment_completion_url ?? null;
    return {
      collection_id: collection.id,
      status: "PENDING" as const,
      expires_at: fresh.quoteExpiresAt,
      prompt_instructions: checkoutUrl
        ? "Open the Payaza checkout link, or approve the prompt on your phone. A response code of 09 means the request was accepted, not that you have paid."
        : "Approve the mobile-money prompt on your phone. A response code of 09 means the prompt was sent, not that you have paid.",
      payaza_checkout_url: checkoutUrl,
      payment_qr: paymentQrText({
        invoiceId: fresh.invoiceId,
        tradeId: fresh.id,
        payToken: token,
        corridor: fresh.corridorId,
        settlementCurrency: "KES",
        amount: fresh.quotedBuyerMinor.toString(),
        payazaCheckoutUrl: checkoutUrl,
      }),
    };
  }

  async applyCollectionWebhook(input: {
    transactionReference: string;
    transactionStatus: string;
    status: string;
    amountValidation?: string;
    amountReceived?: number | string;
    transactionFee?: number | string;
    currency?: string;
    dedupeKey: string;
  }) {
    const collection = await this.deps.repo.collectionByReference(input.transactionReference);
    if (!collection) return { applied: false, reason: "unknown_reference" };
    if (collection.status === "COMPLETED" || collection.status === "FAILED") {
      return { applied: false, reason: "duplicate" };
    }
    const trade = await this.requireTrade(collection.tradeId);
    if (input.status === "Failed" || input.transactionStatus === "Transaction Failed") {
      collection.status = "FAILED";
      await this.deps.repo.saveCollection(collection);
      if (trade.state === "PAYMENT_PENDING") {
        await this.move(trade, "PAYMENT_FAILED", "payaza", "collection failed");
      }
      return { applied: true, state: (await this.requireTrade(trade.id)).state };
    }
    if (input.status !== "Completed" && input.transactionStatus !== "Funds Received") {
      return { applied: false, reason: "not_final" };
    }
    const currency = (input.currency ?? collection.currency) as Currency;
    const amountReceivedMinor = payazaNumberToMinor(input.amountReceived ?? 0, currency);
    const feeMinor = payazaNumberToMinor(input.transactionFee ?? 0, currency);
    const decision = decideCollection({
      validation: input.amountValidation,
      amountReceivedMinor,
      quotedMinor: trade.quotedBuyerMinor,
      alreadyHeldMinor: trade.heldBuyerMinor,
    });
    const journal = journalCollection({
      currency,
      amountReceivedMinor,
      feeMinor,
      holdMinor: decision.holdMinor,
      refundMinor: decision.refundMinor,
      tradeId: trade.id,
    });
    const obligation =
      decision.command === "PAYMENT_EXACT" || decision.command === "PAYMENT_OVER" || decision.command === "TOP_UP"
        ? journalKesObligation({
            exporterNetMinor: trade.exporterNetMinor,
            feeMinor: trade.feeMinor,
            tradeId: trade.id,
          })
        : null;
    collection.status = "COMPLETED";
    trade.heldBuyerMinor += decision.newlyHeldMinor;
    await this.deps.repo.transaction(async (repo) => {
      await repo.postJournal(journal);
      if (obligation) await repo.postJournal(obligation);
      await repo.saveCollection(collection);
      await repo.saveTrade(trade);
    });
    await this.move(trade, decision.command, "payaza", input.amountValidation ?? "collection");
    if (
      this.deps.config.smsConfigured &&
      (decision.command === "PAYMENT_EXACT" || decision.command === "PAYMENT_OVER" || decision.command === "TOP_UP")
    ) {
      await this.deps.notifier
        .sms(trade.buyerPhone, renderTemplate("en", "payment_received", {}))
        .catch(() => undefined);
    }
    return { applied: true, state: (await this.requireTrade(trade.id)).state };
  }

  async ingestPayazaBody(rawBody: string) {
    const body = JSON.parse(rawBody) as Record<string, unknown>;
    if (body.transaction_type === "DEBIT") {
      const reference = String(body.transaction_reference ?? "");
      const payout = await this.deps.repo.payoutByReference(reference);
      if (!payout) return { applied: false, reason: "unknown_payout" };
      const fee = typeof body.transaction_fee === "number" || typeof body.transaction_fee === "string" ? body.transaction_fee : undefined;
      await this.applyPayoutStatus(payout, typeof body.transaction_status === "string" ? body.transaction_status : undefined, fee, body);
      return { applied: true };
    }
    const received = body.received_from && typeof body.received_from === "object";
    if (!received && body.status == null && body.amount_validation == null) {
      return { applied: false, reason: "unrecognised_shape" };
    }
    return this.applyCollectionWebhook({
      transactionReference: String(body.transaction_reference ?? ""),
      transactionStatus: String(body.transaction_status ?? ""),
      status: String(body.status ?? ""),
      amountValidation: typeof body.amount_validation === "string" ? body.amount_validation : undefined,
      amountReceived: typeof body.amount_received === "number" || typeof body.amount_received === "string" ? body.amount_received : undefined,
      transactionFee: typeof body.transaction_fee === "number" || typeof body.transaction_fee === "string" ? body.transaction_fee : undefined,
      currency: typeof body.currency_code === "string" ? body.currency_code : typeof body.currency === "string" ? body.currency : undefined,
      dedupeKey: `${String(body.transaction_reference ?? "")}:${String(body.status ?? "")}`,
    });
  }

  async ship(userId: string, tradeId: string, input: { waybillNo?: string; carrier?: string }) {
    const business = await this.requireBusiness(userId);
    const trade = await this.ownedTrade(business.id, tradeId);
    await this.deps.repo.saveProof({
      id: newId("prf"),
      tradeId: trade.id,
      kind: "DISPATCH",
      objectKey: null,
      waybillNo: input.waybillNo ?? null,
      note: input.carrier ?? null,
    });
    trade.shipWaybill = input.waybillNo ?? null;
    await this.move(trade, "SHIP", userId, "dispatch declared");
    return this.tradeView(trade.id);
  }

  async deliveryClaim(userId: string, tradeId: string) {
    const business = await this.requireBusiness(userId);
    const trade = await this.ownedTrade(business.id, tradeId);
    if (!this.deps.config.smsConfigured) {
      throw new DomainError("CAPABILITY_GATED", "Delivery codes require a configured SMS channel", 409);
    }
    const issued = deliveryCode();
    trade.deliveryCodeHash = issued.hash;
    trade.disputeWindowEndsAt = new Date(this.now().getTime() + this.deps.config.disputeWindowSeconds * 1000).toISOString();
    await this.deps.notifier.sms(trade.buyerPhone, renderTemplate("en", "delivery_code", { code: issued.code }));
    await this.move(trade, "DELIVERY_CLAIMED", userId, "delivery claimed");
    return this.tradeView(trade.id);
  }

  async verifyNfc(tradeId: string, token: string) {
    const trade = await this.requireTrade(tradeId);
    const parsed = readNfcToken(this.deps.config.appSecret, token, this.now());
    if (parsed.tradeId !== trade.id || parsed.escrowHash !== escrowFingerprint(trade.id, trade.itemsMinor.toString())) {
      throw new DomainError("VALIDATION_FAILED", "NFC token does not match this trade", 422);
    }
    if (trade.state !== "SHIPPED" && trade.state !== "DELIVERY_CLAIMED") {
      throw new DomainError("CONFLICT", "This trade is not waiting for delivery verification", 409);
    }
    await this.move(trade, "NFC_VERIFY", "nfc", "tag verified", { nfcOk: true });
    await this.submitRelease(await this.requireTrade(trade.id));
    return this.tradeView(trade.id);
  }

  async verifyNfcForBuyer(payToken: string, nfcToken: string) {
    const { tradeId } = this.parseBuyer(payToken);
    await this.verifyNfc(tradeId, nfcToken);
    return this.tradeView(tradeId, "buyer");
  }

  async confirmDelivery(token: string, code: string) {
    const { tradeId } = this.parseBuyer(token);
    const trade = await this.requireTrade(tradeId);
    if (!trade.deliveryCodeHash) throw new DomainError("CONFLICT", "No delivery code is outstanding", 409);
    await this.move(trade, "CONFIRM_DELIVERY", "buyer", "code confirmed", {
      codeMatches: deliveryCodeMatches(code, trade.deliveryCodeHash),
    });
    await this.submitRelease(await this.requireTrade(trade.id));
    return this.tradeView(trade.id, "buyer");
  }

  async dispute(token: string, reason: string) {
    const { tradeId } = this.parseBuyer(token);
    const trade = await this.requireTrade(tradeId);
    const dispute = { id: newId("dsp"), tradeId: trade.id, reason, status: "OPEN", decision: null, note: null };
    await this.deps.repo.saveDispute(dispute);
    await this.move(trade, "DISPUTE", "buyer", reason);
    return this.tradeView(trade.id, "buyer");
  }

  async resolveDispute(adminId: string, disputeId: string, input: { decision: "RELEASE" | "REFUND" | "SPLIT"; note: string }) {
    const admin = await this.requireUser(adminId);
    if (admin.role !== "ADMIN") throw new DomainError("FORBIDDEN", "Admin role required", 403);
    const dispute = await this.deps.repo.dispute(disputeId);
    if (!dispute) throw new DomainError("NOT_FOUND", "Dispute not found", 404);
    const trade = await this.requireTrade(dispute.tradeId);
    const command: TradeCommand =
      input.decision === "RELEASE" ? "RESOLVE_RELEASE" : input.decision === "REFUND" ? "RESOLVE_REFUND" : "RESOLVE_SPLIT";
    trade.payoutIntent = input.decision === "RELEASE" ? "RELEASE" : input.decision === "REFUND" ? "REFUND" : "SPLIT";
    dispute.status = "RESOLVED";
    dispute.decision = input.decision;
    dispute.note = input.note;
    await this.deps.repo.saveDispute(dispute);
    await this.deps.repo.audit({ id: newId("aud"), actorId: adminId, action: "dispute.resolve", target: disputeId, payload: input });
    await this.move(trade, command, adminId, input.note);
    const updated = await this.requireTrade(trade.id);
    if (updated.state === "RELEASE_PENDING") await this.submitRelease(updated);
    if (updated.state === "REFUND_PENDING") await this.submitRefund(updated);
    return this.tradeView(trade.id);
  }

  async submitRelease(trade: TradeRecord) {
    if (trade.state !== "RELEASE_PENDING") return;
    const existing = (await this.deps.repo.payouts({ tradeId: trade.id })).find((row) => row.kind === "RELEASE" && row.status !== "FAILED");
    if (existing) return;
    await this.createAndSendPayout(trade, "RELEASE", "KES", trade.exporterNetMinor);
  }

  async submitRefund(trade: TradeRecord) {
    if (trade.state !== "REFUND_PENDING") return;
    await this.createAndSendPayout(trade, "REFUND", trade.buyerCurrency, trade.heldBuyerMinor);
  }

  async recheckPayout(adminId: string, payoutId: string) {
    const admin = await this.requireUser(adminId);
    if (admin.role !== "ADMIN") throw new DomainError("FORBIDDEN", "Admin role required", 403);
    const payout = await this.deps.repo.payout(payoutId);
    if (!payout) throw new DomainError("NOT_FOUND", "Payout not found", 404);
    const status = await this.deps.rails.payoutStatus(payout.transactionReference);
    await this.applyPayoutStatus(payout, status.transactionStatus, status.fee, status.raw);
    return payoutViewRow(await this.deps.repo.payout(payoutId));
  }

  async retryPayout(adminId: string, payoutId: string) {
    const admin = await this.requireUser(adminId);
    if (admin.role !== "ADMIN") throw new DomainError("FORBIDDEN", "Admin role required", 403);
    const payout = await this.deps.repo.payout(payoutId);
    if (!payout) throw new DomainError("NOT_FOUND", "Payout not found", 404);
    if (!payout.failureConfirmed) {
      throw new DomainError("ILLEGAL_STATE_TRANSITION", "Retry only after Payaza confirms failure", 409);
    }
    const trade = await this.requireTrade(payout.tradeId);
    await this.move(trade, "RETRY_PAYOUT", adminId, "reviewed retry", {
      payazaConfirmedFailure: true,
      payoutIntent: trade.payoutIntent,
    });
    const updated = await this.requireTrade(trade.id);
    if (updated.state === "RELEASE_PENDING") await this.submitRelease(updated);
    if (updated.state === "REFUND_PENDING") await this.submitRefund(updated);
    return this.tradeView(trade.id);
  }

  async recordTreasury(adminId: string, input: {
    sellCurrency: Currency;
    sellMinor: bigint;
    buyCurrency: Currency;
    buyMinor: bigint;
    rate: string;
    counterparty: string;
    evidenceRef: string;
  }) {
    const admin = await this.requireUser(adminId);
    if (admin.role !== "ADMIN") throw new DomainError("FORBIDDEN", "Admin role required", 403);
    assertTreasuryEvidence({ ...input, evidenceRef: input.evidenceRef, counterparty: input.counterparty });
    const entry = journalTreasuryConversion({
      sellCurrency: input.sellCurrency,
      sellMinor: input.sellMinor,
      buyCurrency: input.buyCurrency,
      buyMinor: input.buyMinor,
      releaseHold: true,
    });
    await this.deps.repo.transaction(async (repo) => {
      await repo.postJournal(entry);
      await repo.saveTreasury({ id: newId("trs"), ...input, actorId: adminId });
      await repo.audit({ id: newId("aud"), actorId: adminId, action: "treasury.conversion", target: input.evidenceRef, payload: { rate: input.rate } });
    });
    return { recorded: true };
  }

  async exposure() {
    const balances = await this.asBalances();
    return { open_exposure_kes_minor: openExposureKes(balances).toString() };
  }

  async reconciliation(payaza: { currency: Currency; balanceMinor: bigint }[]) {
    const flags = reconcile({ ledger: await this.asBalances(), payaza });
    return {
      drift: flags.map((flag) => ({
        currency: flag.currency,
        ledger_minor: flag.ledgerMinor.toString(),
        payaza_minor: flag.payazaMinor.toString(),
        drift_minor: flag.driftMinor.toString(),
      })),
    };
  }

  async creditScore(userId: string) {
    if (!this.deps.config.creditEnabled) {
      throw new DomainError("CAPABILITY_GATED", "Trade-record scoring is disabled", 409);
    }
    const business = await this.requireBusiness(userId);
    const records = await this.deps.repo.records(business.id);
    return scoreTradeRecords(records, this.deps.config.creditMinRecords);
  }

  async records(userId: string) {
    const business = await this.requireBusiness(userId);
    return this.deps.repo.records(business.id);
  }

  requireAccessToken(header: string | undefined): { sub: string; role: string } {
    if (!header?.startsWith("Bearer ")) throw new DomainError("UNAUTHENTICATED", "Bearer token required", 401);
    try {
      const payload = verifyJwt(header.slice(7), this.deps.config.appSecret);
      if (typeof payload.sub !== "string" || typeof payload.role !== "string") throw new Error("malformed");
      return { sub: payload.sub, role: payload.role };
    } catch {
      throw new DomainError("UNAUTHENTICATED", "Access token is invalid", 401);
    }
  }

  private assertSettlementForNewTrade() {
    if (this.deps.config.settlementMode !== "treasury_float") {
      assertSettlementAvailable(this.deps.config.settlementMode);
    }
  }

  private async createAndSendPayout(trade: TradeRecord, kind: PayoutRecord["kind"], currency: Currency, amountMinor: bigint) {
    const business = await this.deps.repo.businessById(trade.businessId);
    if (!business) throw new DomainError("NOT_FOUND", "Business missing", 404);
    const method = await this.deps.repo.payoutMethod(trade.payoutMethodId);
    if (!method) throw new DomainError("RECIPIENT_NOT_VERIFIED", "Payout method missing", 409);
    assertPayoutAllowed(amountMinor, {
      maxInvoiceKesMinor: this.deps.config.maxInvoiceKesMinor,
      firstPayoutKesMinor: this.deps.config.firstPayoutKesMinor,
      maxPayoutsPerDay: this.deps.config.maxPayoutsPerDay,
      kycTier: business.kycTier,
    }, {
      priorPayoutCount: await this.deps.repo.succeededPayoutCount(business.id),
      payoutsToday: await this.deps.repo.countPayoutsSince(business.id, new Date(this.now().getTime() - 86_400_000).toISOString()),
      openInvoiceKesMinor: 0n,
    });
    if (!this.deps.config.transactionPin) {
      throw new DomainError("CAPABILITY_GATED", "PAYAZA_TRANSACTION_PIN is not configured", 409);
    }
    const account = await this.deps.rails.kesAccount();
    if (!account || account.currency !== "KES") {
      throw new DomainError("CAPABILITY_GATED", "No KES Payaza account reference was returned", 409);
    }
    if (account.postNoDebit) {
      throw new DomainError("CAPABILITY_GATED", "Payaza postNoDebit is true. Payouts are blocked until support lifts PND.", 409);
    }
    if (currency !== "KES") {
      throw new DomainError(
        "CAPABILITY_GATED",
        "A buyer-currency refund payout needs a Payaza mobile-money bank code confirmed for that currency. None is on file.",
        409,
      );
    }
    const bankCode = await this.deps.rails.kesMobileMoneyCode(this.deps.config.kesMomoBankCode);
    const reference = payoutReference();
    const payout: PayoutRecord = {
      id: newId("pyo"),
      tradeId: trade.id,
      transactionReference: reference,
      kind,
      status: "INITIATED",
      currency,
      amountMinor,
      feeMinor: 0n,
      bankCode,
      accountNumber: kind === "REFUND" ? trade.buyerPhone : method.phone,
      accountName: kind === "REFUND" ? trade.buyerName : method.accountName,
      failureConfirmed: false,
      lastError: null,
      rawResponse: null,
    };
    await this.deps.repo.savePayout(payout);
    const corridor = corridorById(trade.corridorId);
    try {
      const response = await this.deps.rails.initiatePayout({
        transaction_type: currency === "KES" ? "mobile_money" : corridor.payoutTransactionType,
        pin: this.deps.config.transactionPin,
        account_reference: account.payazaAccountReference,
        currency,
        country: currency === "KES" ? "KEN" : corridor.buyerCountryAlpha3,
        credit_amount: minorToPayazaNumber(amountMinor, currency),
        account_number: payout.accountNumber,
        account_name: payout.accountName,
        bank_code: bankCode,
        narration: payoutNarration("VukaPay payout"),
        transaction_reference: reference,
        sender_name: business.tradingName,
        sender_phone_number: method.phone,
        sender_address: "Nairobi KE",
      });
      payout.status = "PENDING";
      payout.rawResponse = response.raw;
      await this.deps.repo.savePayout(payout);
    } catch (error) {
      const status = await this.deps.rails.payoutStatus(reference).catch(() => ({ transactionStatus: undefined, fee: undefined, raw: null }));
      if (status.transactionStatus) {
        await this.applyPayoutStatus(payout, status.transactionStatus, status.fee, status.raw);
        return;
      }
      payout.status = "FAILED";
      payout.failureConfirmed = true;
      payout.lastError = error instanceof Error ? error.message : "payout rejected";
      await this.deps.repo.savePayout(payout);
      const latest = await this.requireTrade(trade.id);
      if (latest.state === "RELEASE_PENDING" || latest.state === "REFUND_PENDING" || latest.state === "SPLIT_PENDING") {
        await this.move(latest, "PAYOUT_FAILED", "payaza", payout.lastError);
      }
    }
  }

  private async applyPayoutStatus(payout: PayoutRecord, status: string | undefined, fee: number | string | undefined, raw: unknown) {
    const trade = await this.requireTrade(payout.tradeId);
    if (status === "NIP_SUCCESS") {
      const feeMinor = fee === undefined ? 0n : payazaNumberToMinor(fee, payout.currency);
      const entry = payout.kind === "REFUND"
        ? journalRefundPayout({
            currency: payout.currency,
            amountMinor: payout.amountMinor,
            feeMinor,
            tradeId: trade.id,
            reverseKesObligation: { exporterNetMinor: trade.exporterNetMinor, feeMinor: trade.feeMinor },
          })
        : journalPayout({ amountMinor: payout.amountMinor, feeMinor, tradeId: trade.id });
      payout.status = "SUCCEEDED";
      payout.feeMinor = feeMinor;
      payout.rawResponse = raw;
      await this.deps.repo.transaction(async (repo) => {
        await repo.postJournal(entry);
        await repo.savePayout(payout);
      });
      await this.move(trade, "PAYOUT_SUCCEEDED", "payaza", status);
      return;
    }
    if (status === "NIP_FAILURE") {
      payout.status = "FAILED";
      payout.failureConfirmed = true;
      payout.rawResponse = raw;
      await this.deps.repo.savePayout(payout);
      if (trade.state !== "PAYOUT_FAILED") await this.move(trade, "PAYOUT_FAILED", "payaza", status);
      return;
    }
    payout.status = "PENDING";
    payout.rawResponse = raw;
    await this.deps.repo.savePayout(payout);
  }

  private async move(trade: TradeRecord, command: TradeCommand, actor: string, reason: string, extra: Record<string, unknown> = {}) {
    const event = transition(trade.state, {
      command,
      actor,
      reason,
      now: this.now(),
      quoteExpiresAt: new Date(trade.quoteExpiresAt),
      invoiceDeadline: new Date(trade.invoiceDeadline),
      disputeWindowEndsAt: trade.disputeWindowEndsAt ? new Date(trade.disputeWindowEndsAt) : null,
      payoutIntent: (extra.payoutIntent as PayoutIntent) ?? trade.payoutIntent,
      payazaConfirmedFailure: extra.payazaConfirmedFailure === true,
      codeMatches: extra.codeMatches === true,
      nfcOk: extra.nfcOk === true,
      attemptCount: typeof extra.attemptCount === "number" ? extra.attemptCount : trade.attemptCount,
      maxAttempts: 3,
    });
    trade.state = event.toState;
    trade.updatedAt = this.now().toISOString();
    await this.deps.repo.transaction(async (repo) => {
      await repo.saveTrade(trade);
      await repo.appendEvent(this.eventRow(trade.id, event));
      if (event.effects.includes("WRITE_TRADE_RECORD")) {
        await this.writeRecord(repo, trade, trade.state === "PAID_OUT", null);
      }
    });
  }

  private async writeRecord(repo: Repository, trade: TradeRecord, onTime: boolean | null, disputeOutcome: "RELEASE" | "REFUND" | "SPLIT" | null) {
    if (!["PAID_OUT", "REFUNDED", "CANCELLED", "EXPIRED", "PAYMENT_FAILED"].includes(trade.state)) return;
    await repo.saveRecord({
      id: newId("rec"),
      tradeId: trade.id,
      businessId: trade.businessId,
      corridorId: trade.corridorId,
      terminalState: trade.state,
      counterpartyKey: sha256Hex(trade.buyerPhone),
      amountKesMinor: trade.itemsMinor,
      onTime,
      disputed: disputeOutcome !== null,
      disputeOutcome,
      completedAt: this.now().toISOString(),
    });
  }

  private newTrade(invoice: InvoiceRecord, payoutMethodId: string): TradeRecord {
    const deadline = invoice.shippingDeadline ?? new Date(this.now().getTime() + 14 * 86_400_000).toISOString();
    return {
      id: newId("trd"),
      invoiceId: invoice.id,
      businessId: invoice.businessId,
      state: "DRAFT",
      corridorId: invoice.corridorId,
      buyerCurrency: invoice.currency,
      itemsMinor: invoice.itemsMinor,
      feeMinor: invoice.feeMinor,
      exporterNetMinor: invoice.exporterNetMinor,
      quotedBuyerMinor: invoice.buyerAmountMinor,
      heldBuyerMinor: 0n,
      quoteExpiresAt: invoice.quoteExpiresAt,
      invoiceDeadline: deadline,
      disputeWindowEndsAt: null,
      buyerName: invoice.buyerName,
      buyerPhone: invoice.buyerPhone,
      payoutMethodId,
      payoutIntent: "RELEASE",
      attemptCount: 0,
      deliveryCodeHash: null,
      shipWaybill: null,
      createdAt: this.now().toISOString(),
      updatedAt: this.now().toISOString(),
    };
  }

  private eventRow(tradeId: string, event: ReturnType<typeof transition>) {
    return {
      id: newId("evt"),
      tradeId,
      fromState: event.fromState,
      toState: event.toState,
      command: event.command,
      actor: event.actor,
      reason: event.reason,
      payloadHash: event.payloadHash,
      effects: event.effects,
      createdAt: event.at,
    };
  }

  private async tokens(user: UserRecord) {
    const access = signJwt({ sub: user.id, role: user.role }, this.deps.config.appSecret, 15 * 60);
    const refresh = signJwt({ sub: user.id, typ: "refresh", jti: randomToken(8) }, this.deps.config.appSecret, 30 * 86_400);
    await this.deps.repo.saveRefresh({
      id: newId("rfr"),
      userId: user.id,
      tokenHash: sha256Hex(refresh),
      expiresAt: new Date(this.now().getTime() + 30 * 86_400_000).toISOString(),
      revokedAt: null,
    });
    return { access_token: access, refresh_token: refresh, token_type: "Bearer" as const, expires_in: 900 };
  }

  private readRefresh(token: string): { sub: string } {
    try {
      const payload = verifyJwt(token, this.deps.config.appSecret);
      if (payload.typ !== "refresh" || typeof payload.sub !== "string") throw new Error("malformed");
      return { sub: payload.sub };
    } catch {
      throw new DomainError("UNAUTHENTICATED", "Refresh token is invalid", 401);
    }
  }

  private buyerLink(tradeId: string) {
    const signed = signTradeToken(tradeId, this.deps.config.appSecret, 7 * 86_400);
    return { url: `/v1/pay/${signed.token}`, token: signed.token, expiresAt: signed.expiresAt };
  }

  private parseBuyer(token: string) {
    try {
      return readTradeToken(token, this.deps.config.appSecret);
    } catch {
      throw new DomainError("UNAUTHENTICATED", "Payment link is invalid or expired", 401);
    }
  }

  private async withBuyer<T>(token: string, work: (trade: TradeRecord) => Promise<T>) {
    const { tradeId } = this.parseBuyer(token);
    return work(await this.requireTrade(tradeId));
  }

  private async requireUser(id: string) {
    const user = await this.deps.repo.userById(id);
    if (!user) throw new DomainError("UNAUTHENTICATED", "User not found", 401);
    return user;
  }

  private async requireBusiness(userId: string) {
    const business = await this.deps.repo.businessByUser(userId);
    if (!business) throw new DomainError("NOT_FOUND", "Business profile missing", 404);
    return business;
  }

  private async requireMethod(businessId: string, id: string) {
    const method = await this.deps.repo.payoutMethod(id);
    if (!method || method.businessId !== businessId) throw new DomainError("NOT_FOUND", "Payout method not found", 404);
    return method;
  }

  private async requireInvoice(businessId: string, id: string) {
    const invoice = await this.deps.repo.invoice(id);
    if (!invoice || invoice.businessId !== businessId) throw new DomainError("NOT_FOUND", "Invoice not found", 404);
    return invoice;
  }

  private async requireTrade(id: string) {
    const trade = await this.deps.repo.trade(id);
    if (!trade) throw new DomainError("NOT_FOUND", "Trade not found", 404);
    return trade;
  }

  private async ownedTrade(businessId: string, id: string) {
    const trade = await this.requireTrade(id);
    if (trade.businessId !== businessId) throw new DomainError("NOT_FOUND", "Trade not found", 404);
    return trade;
  }

  private async tradeView(id: string, viewer: "exporter" | "buyer" = "exporter") {
    const trade = await this.requireTrade(id);
    const events = await this.deps.repo.events(id);
    const business = await this.deps.repo.businessById(trade.businessId);
    const invoice = await this.deps.repo.invoice(trade.invoiceId);
    const method = await this.deps.repo.payoutMethod(trade.payoutMethodId);
    const payouts = await this.deps.repo.payouts({ tradeId: trade.id });
    const paid = payouts.find((row) => row.status === "SUCCEEDED" && row.kind === "RELEASE");
    const payoutVerified = method?.status === "VERIFIED" || method?.status === "LOCKED";
    const shipped = events.find((event) => event.command === "SHIP");
    const nfcToken =
      viewer === "exporter" && shipped
        ? issueNfcToken(this.deps.config.appSecret, {
            tradeId: trade.id,
            escrowHash: escrowFingerprint(trade.id, trade.itemsMinor.toString()),
            issuedAt: shipped.createdAt,
          })
        : null;
    return {
      id: trade.id,
      state: trade.state,
      corridor: trade.corridorId,
      kes_total: money(trade.itemsMinor, "KES"),
      fee_breakdown: {
        goods: money(trade.itemsMinor, "KES"),
        vukapay_fee: money(trade.feeMinor, "KES"),
        exporter_net: money(trade.exporterNetMinor, "KES"),
        payaza_processing: "recorded_on_settlement" as const,
      },
      buyer_amount: money(trade.quotedBuyerMinor, trade.buyerCurrency),
      held_buyer_amount: money(trade.heldBuyerMinor, trade.buyerCurrency),
      quote_expires_at: trade.quoteExpiresAt,
      rate: invoice?.midRate ?? null,
      spread_bps: invoice?.spreadBps ?? null,
      invoice_id: invoice?.id ?? null,
      shipping_deadline: invoice?.shippingDeadline ?? null,
      dispute_window_hours: invoice?.disputeWindowHours ?? null,
      mpesa_reference: paid?.transactionReference ?? null,
      nfc_token: nfcToken,
      available_actions: availableActions(trade.state, viewer),
      parties: {
        exporter: {
          display_name: business?.tradingName ?? "",
          business_name: business?.legalName ?? "",
          avatar_url: null,
          logo_url: null,
          badge: payoutVerified ? ("payout_verified" as const) : null,
        },
        buyer: {
          display_name: trade.buyerName,
          business_name: trade.buyerName,
          avatar_url: null,
          logo_url: null,
          badge: null,
        },
      },
      timeline: events,
    };
  }

  private async asBalances(): Promise<AccountBalance[]> {
    const rows = await this.deps.repo.ledgerBalances();
    return rows.map((row) => ({
      account: row.account as LedgerAccount,
      currency: row.currency,
      debitMinor: row.debitMinor,
      creditMinor: row.creditMinor,
    }));
  }
}

function money(amountMinor: bigint, currency: Currency) {
  return { amount_minor: amountMinor.toString(), currency };
}

function invoiceView(invoice: InvoiceRecord) {
  return {
    id: invoice.id,
    status: invoice.status,
    corridor: invoice.corridorId,
    buyer: { name: invoice.buyerName, phone: invoice.buyerPhone, country: invoice.buyerCountry, currency: invoice.currency },
    kes_total: money(invoice.itemsMinor, "KES"),
    fee_breakdown: {
      vukapay_fee: money(invoice.feeMinor, "KES"),
      exporter_net: money(invoice.exporterNetMinor, "KES"),
      payaza_processing: "recorded_on_settlement",
    },
    buyer_amount: money(invoice.buyerAmountMinor, invoice.currency),
    rate: invoice.midRate,
    spread_bps: invoice.spreadBps,
    quote_expires_at: invoice.quoteExpiresAt,
    shipping_deadline: invoice.shippingDeadline,
    dispute_window_hours: invoice.disputeWindowHours,
    exporter_net: money(invoice.exporterNetMinor, "KES"),
    items: invoice.items.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unit_amount: money(item.unitMinor, "KES"),
    })),
  };
}

function payoutView(row: PayoutMethodRecord) {
  return { id: row.id, phone: row.phone, currency: row.currency, verification: { status: row.status } };
}

function payoutViewRow(row: PayoutRecord | null) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    transaction_reference: row.transactionReference,
    amount: money(row.amountMinor, row.currency),
    failure_confirmed: row.failureConfirmed,
  };
}

function userIsAdmin(user: UserRecord) {
  return user.role === "ADMIN";
}

function maskPhone(phone: string): string {
  if (phone.length < 6) return "***";
  return `${phone.slice(0, 3)}*****${phone.slice(-2)}`;
}

export { invoiceView, money };
