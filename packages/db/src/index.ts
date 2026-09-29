import { Prisma, PrismaClient } from "@prisma/client";
import type {
  BusinessRecord,
  CollectionRecord,
  InvoiceRecord,
  Journal,
  PartnershipRecord,
  PayoutMethodRecord,
  PayoutRecord,
  RefreshRecord,
  Repository,
  TradeEventRecord,
  TradeRecord,
  UserRecord,
} from "@vukapay/core";
import type { Currency } from "@vukapay/core";
import type { TradeState } from "@vukapay/core";

type Db = PrismaClient | Prisma.TransactionClient;

export class PrismaRepository implements Repository {
  constructor(private readonly db: Db) {}

  async transaction<T>(work: (repo: Repository) => Promise<T>): Promise<T> {
    const client = this.db as PrismaClient;
    return client.$transaction(async (tx) => work(new PrismaRepository(tx)));
  }

  async saveUser(user: UserRecord) {
    const data = {
      email: user.email,
      passwordHash: user.passwordHash,
      role: user.role,
      phone: user.phone,
      displayName: user.displayName,
      language: user.language,
    };
    await this.db.user.upsert({
      where: { id: user.id },
      create: { id: user.id, ...data, createdAt: new Date(user.createdAt) },
      update: data,
    });
  }
  async userByEmail(email: string) {
    const row = await this.db.user.findUnique({ where: { email } });
    return row ? userFromDb(row) : null;
  }
  async userById(id: string) {
    const row = await this.db.user.findUnique({ where: { id } });
    return row ? userFromDb(row) : null;
  }
  async saveRefresh(row: RefreshRecord) {
    await this.db.refreshToken.upsert({
      where: { id: row.id },
      create: { ...row, expiresAt: new Date(row.expiresAt), revokedAt: row.revokedAt ? new Date(row.revokedAt) : null },
      update: { revokedAt: row.revokedAt ? new Date(row.revokedAt) : null },
    });
  }
  async refreshByHash(hash: string) {
    const row = await this.db.refreshToken.findUnique({ where: { tokenHash: hash } });
    if (!row) return null;
    return { ...row, expiresAt: row.expiresAt.toISOString(), revokedAt: row.revokedAt?.toISOString() ?? null };
  }
  async saveBusiness(row: BusinessRecord) {
    await this.db.business.upsert({ where: { id: row.id }, create: row, update: row });
  }
  async businessByUser(userId: string): Promise<BusinessRecord | null> {
    const row = await this.db.business.findUnique({ where: { userId } });
    return row ? businessFromDb(row) : null;
  }
  async businessById(id: string): Promise<BusinessRecord | null> {
    const row = await this.db.business.findUnique({ where: { id } });
    return row ? businessFromDb(row) : null;
  }
  async savePayoutMethod(row: PayoutMethodRecord) {
    const data = {
      ...row,
      coolingOffUntil: row.coolingOffUntil ? new Date(row.coolingOffUntil) : null,
      verifiedAt: row.verifiedAt ? new Date(row.verifiedAt) : null,
      otpExpiresAt: row.otpExpiresAt ? new Date(row.otpExpiresAt) : null,
    };
    await this.db.payoutMethod.upsert({ where: { id: row.id }, create: data, update: data });
  }
  async payoutMethods(businessId: string) {
    const rows = await this.db.payoutMethod.findMany({ where: { businessId } });
    return rows.map(methodFromDb);
  }
  async payoutMethod(id: string) {
    const row = await this.db.payoutMethod.findUnique({ where: { id } });
    return row ? methodFromDb(row) : null;
  }
  async saveInvoice(row: InvoiceRecord) {
    const data = {
      businessId: row.businessId,
      status: row.status,
      corridorId: row.corridorId,
      buyerName: row.buyerName,
      buyerPhone: row.buyerPhone,
      buyerCountry: row.buyerCountry,
      networkCode: row.networkCode,
      currency: row.currency,
      itemsMinor: row.itemsMinor,
      feeMinor: row.feeMinor,
      exporterNetMinor: row.exporterNetMinor,
      buyerAmountMinor: row.buyerAmountMinor,
      midRate: row.midRate,
      spreadBps: row.spreadBps,
      quoteExpiresAt: new Date(row.quoteExpiresAt),
      quoteSources: row.quoteSources,
      notes: row.notes,
      shippingDeadline: row.shippingDeadline ? new Date(row.shippingDeadline) : null,
      disputeWindowHours: row.disputeWindowHours,
      fingerprint: row.fingerprint,
      partnershipId: row.partnershipId,
    };
    await this.db.invoice.upsert({ where: { id: row.id }, create: { id: row.id, ...data }, update: data });
    await this.db.invoiceItem.deleteMany({ where: { invoiceId: row.id } });
    if (row.items.length > 0) {
      await this.db.invoiceItem.createMany({
        data: row.items.map((item: InvoiceRecord["items"][number]) => ({ ...item, invoiceId: row.id })),
      });
    }
  }
  async invoice(id: string) {
    const row = await this.db.invoice.findUnique({ where: { id }, include: { items: true } });
    return row ? invoiceFromDb(row) : null;
  }
  async invoices(businessId: string) {
    const rows = await this.db.invoice.findMany({ where: { businessId }, include: { items: true } });
    return rows.map(invoiceFromDb);
  }
  async fingerprints(businessId: string) {
    const rows = await this.db.invoice.findMany({ where: { businessId, status: { not: "CANCELLED" } }, select: { fingerprint: true } });
    return rows.map((row) => row.fingerprint);
  }
  async saveTrade(row: TradeRecord) {
    const data = {
      ...row,
      quoteExpiresAt: new Date(row.quoteExpiresAt),
      invoiceDeadline: new Date(row.invoiceDeadline),
      disputeWindowEndsAt: row.disputeWindowEndsAt ? new Date(row.disputeWindowEndsAt) : null,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    };
    await this.db.trade.upsert({ where: { id: row.id }, create: data, update: data });
  }
  async trade(id: string) {
    const row = await this.db.trade.findUnique({ where: { id } });
    return row ? tradeFromDb(row) : null;
  }
  async tradeByInvoice(invoiceId: string) {
    const row = await this.db.trade.findUnique({ where: { invoiceId } });
    return row ? tradeFromDb(row) : null;
  }
  async trades(filter?: { businessId?: string; state?: string; corridorId?: string }) {
    const rows = await this.db.trade.findMany({ where: filter });
    return rows.map(tradeFromDb);
  }
  async appendEvent(row: TradeEventRecord) {
    await this.db.tradeEvent.create({ data: { ...row, effects: row.effects, createdAt: new Date(row.createdAt) } });
  }
  async events(tradeId: string) {
    const rows = await this.db.tradeEvent.findMany({ where: { tradeId }, orderBy: { createdAt: "asc" } });
    return rows.map((row) => ({ ...row, effects: row.effects as string[], createdAt: row.createdAt.toISOString() }));
  }
  async saveCollection(row: CollectionRecord) {
    await this.db.collection.upsert({
      where: { id: row.id },
      create: { ...row, rawResponse: (row.rawResponse ?? Prisma.JsonNull) as Prisma.InputJsonValue },
      update: { ...row, rawResponse: (row.rawResponse ?? Prisma.JsonNull) as Prisma.InputJsonValue },
    });
  }
  async collectionByReference(reference: string) {
    const row = await this.db.collection.findUnique({ where: { transactionReference: reference } });
    return row ? { ...row, status: row.status as CollectionRecord["status"], currency: row.currency as Currency, rawResponse: row.rawResponse } : null;
  }
  async collections(tradeId: string) {
    const rows = await this.db.collection.findMany({ where: { tradeId } });
    return rows.map((row) => ({ ...row, status: row.status as CollectionRecord["status"], currency: row.currency as Currency, rawResponse: row.rawResponse }));
  }
  async savePayout(row: PayoutRecord) {
    const data = { ...row, rawResponse: (row.rawResponse ?? Prisma.JsonNull) as Prisma.InputJsonValue };
    await this.db.payout.upsert({ where: { id: row.id }, create: data, update: data });
  }
  async payout(id: string) {
    const row = await this.db.payout.findUnique({ where: { id } });
    return row ? payoutFromDb(row) : null;
  }
  async payoutByReference(reference: string) {
    const row = await this.db.payout.findUnique({ where: { transactionReference: reference } });
    return row ? payoutFromDb(row) : null;
  }
  async payouts(filter?: { tradeId?: string; businessId?: string }) {
    const rows = await this.db.payout.findMany({
      where: filter?.businessId
        ? { trade: { businessId: filter.businessId }, ...(filter.tradeId ? { tradeId: filter.tradeId } : {}) }
        : filter?.tradeId
          ? { tradeId: filter.tradeId }
          : {},
    });
    return rows.map(payoutFromDb);
  }
  async postJournal(journal: Journal) {
    await this.db.ledgerTransaction.create({
      data: {
        id: crypto.randomUUID(),
        tradeId: journal.tradeId,
        kind: journal.kind,
        entries: {
          create: journal.lines.map((line) => ({
            id: crypto.randomUUID(),
            accountCode: line.account,
            currency: line.currency,
            debitMinor: line.debitMinor,
            creditMinor: line.creditMinor,
          })),
        },
      },
    });
  }
  async ledgerBalances() {
    const rows = await this.db.ledgerEntry.groupBy({
      by: ["accountCode", "currency"],
      _sum: { debitMinor: true, creditMinor: true },
    });
    return rows.map((row) => ({
      account: row.accountCode,
      currency: row.currency as Currency,
      debitMinor: row._sum.debitMinor ?? 0n,
      creditMinor: row._sum.creditMinor ?? 0n,
    }));
  }
  async countPayoutsSince(businessId: string, sinceIso: string) {
    return this.db.payout.count({ where: { createdAt: { gte: new Date(sinceIso) }, trade: { businessId } } });
  }
  async succeededPayoutCount(businessId: string) {
    return this.db.payout.count({ where: { status: "SUCCEEDED", trade: { businessId } } });
  }
  async openInvoiceMinor(businessId: string) {
    const rows = await this.db.invoice.findMany({ where: { businessId, status: { not: "CANCELLED" } }, select: { itemsMinor: true } });
    return rows.reduce((sum, row) => sum + row.itemsMinor, 0n);
  }
  async saveIdempotency(row: { key: string; userScope: string; method: string; path: string; requestHash: string; statusCode: number; responseBody: unknown }) {
    await this.db.idempotencyKey.create({
      data: { id: crypto.randomUUID(), ...row, responseBody: row.responseBody as Prisma.InputJsonValue },
    });
  }
  async idempotency(key: string, userScope: string, method: string, path: string) {
    const row = await this.db.idempotencyKey.findUnique({ where: { key_userScope_method_path: { key, userScope, method, path } } });
    return row ? { requestHash: row.requestHash, statusCode: row.statusCode, responseBody: row.responseBody } : null;
  }
  async savePayazaEvent(row: { id: string; rawBody: string; signatureOk: boolean; transactionReference: string | null; dedupeKey: string | null }) {
    await this.db.payazaEvent.create({ data: row });
  }
  async unprocessedPayazaEvents() {
    return this.db.payazaEvent.findMany({ where: { processedAt: null, signatureOk: true } });
  }
  async markPayazaEvent(id: string, error: string | null) {
    await this.db.payazaEvent.update({ where: { id }, data: { processedAt: new Date(), processError: error } });
  }
  async saveDispute(row: { id: string; tradeId: string; reason: string; status: string; decision: string | null; note: string | null }) {
    await this.db.dispute.upsert({ where: { id: row.id }, create: row, update: row });
  }
  async disputes() {
    return this.db.dispute.findMany();
  }
  async dispute(id: string) {
    return this.db.dispute.findUnique({ where: { id } });
  }
  async saveProof(row: { id: string; tradeId: string; kind: string; objectKey: string | null; waybillNo: string | null; note: string | null }) {
    await this.db.deliveryProof.create({ data: row });
  }
  async savePartnership(row: PartnershipRecord) {
    await this.db.tradingPartnership.upsert({ where: { id: row.id }, create: row, update: row });
  }
  async partnerships(businessId: string) {
    return (await this.db.tradingPartnership.findMany({ where: { businessId } })) as PartnershipRecord[];
  }
  async partnership(id: string) {
    return this.db.tradingPartnership.findUnique({ where: { id } }) as Promise<PartnershipRecord | null>;
  }
  async saveRecord(row: {
    id: string; tradeId: string; businessId: string; corridorId: string; terminalState: string; counterpartyKey: string;
    amountKesMinor: bigint; onTime: boolean | null; disputed: boolean; disputeOutcome: string | null; completedAt: string;
  }) {
    await this.db.tradeRecordRow.create({ data: { ...row, completedAt: new Date(row.completedAt) } });
  }
  async records(businessId: string) {
    const rows = await this.db.tradeRecordRow.findMany({ where: { businessId } });
    return rows.map((row) => ({
      id: row.id,
      tradeId: row.tradeId,
      terminalState: row.terminalState as "PAID_OUT",
      corridor: row.corridorId,
      onTime: row.onTime,
      disputed: row.disputed,
      disputeOutcome: row.disputeOutcome as "RELEASE" | null,
      counterpartyKey: row.counterpartyKey,
      completedAt: row.completedAt,
      amountKesMinor: row.amountKesMinor,
    }));
  }
  async saveConsent(row: { id: string; businessId: string; lenderName: string; tokenHash: string; expiresAt: string; revokedAt: string | null }) {
    await this.db.creditConsent.upsert({
      where: { id: row.id },
      create: { ...row, expiresAt: new Date(row.expiresAt), revokedAt: row.revokedAt ? new Date(row.revokedAt) : null },
      update: { revokedAt: row.revokedAt ? new Date(row.revokedAt) : null },
    });
  }
  async consents(businessId: string) {
    const rows = await this.db.creditConsent.findMany({ where: { businessId } });
    return rows.map((row) => ({ id: row.id, lenderName: row.lenderName, expiresAt: row.expiresAt.toISOString(), revokedAt: row.revokedAt?.toISOString() ?? null }));
  }
  async revokeConsent(id: string, businessId: string) {
    await this.db.creditConsent.updateMany({ where: { id, businessId }, data: { revokedAt: new Date() } });
  }
  async audit(row: { id: string; actorId: string; action: string; target: string; payload: unknown }) {
    await this.db.auditLog.create({ data: { ...row, payload: row.payload as Prisma.InputJsonValue } });
  }
  async saveTreasury(row: { id: string; sellCurrency: Currency; sellMinor: bigint; buyCurrency: Currency; buyMinor: bigint; rate: string; counterparty: string; evidenceRef: string; actorId: string }) {
    await this.db.treasuryConversion.create({ data: row });
  }
  async treasury() {
    const rows = await this.db.treasuryConversion.findMany({ orderBy: { createdAt: "desc" } });
    return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
  }
  async saveKyc(row: { id: string; businessId: string; kind: string; objectKey: string }) {
    await this.db.kycDocument.create({ data: row });
  }
  async kyc(businessId: string) {
    return this.db.kycDocument.findMany({ where: { businessId } });
  }
  async saveNotification(row: { id: string; channel: string; toMasked: string; template: string; status: string }) {
    await this.db.notification.create({ data: { id: row.id, channel: row.channel, toMasked: row.toMasked, template: row.template, status: row.status } });
  }
  async flags() {
    const rows = await this.db.featureFlag.findMany();
    return Object.fromEntries(rows.map((row) => [row.key, row.enabled]));
  }
  async setFlag(key: string, enabled: boolean) {
    await this.db.featureFlag.upsert({ where: { key }, create: { key, enabled }, update: { enabled } });
  }
}

function userFromDb(row: {
  id: string;
  email: string;
  passwordHash: string;
  role: string;
  displayName: string;
  phone: string | null;
  language: string;
  createdAt: Date;
}): UserRecord {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.passwordHash,
    role: oneOf(row.role, ["EXPORTER", "ADMIN", "AGENT"] as const, "role"),
    displayName: row.displayName,
    phone: row.phone,
    language: oneOf(row.language, ["en", "sw"] as const, "language"),
    createdAt: row.createdAt.toISOString(),
  };
}

function businessFromDb(row: {
  id: string;
  userId: string;
  legalName: string;
  tradingName: string;
  country: string;
  kycTier: string;
  nationalIdNumber: string | null;
  kraPin: string | null;
}): BusinessRecord {
  return {
    id: row.id,
    userId: row.userId,
    legalName: row.legalName,
    tradingName: row.tradingName,
    country: row.country,
    kycTier: oneOf(row.kycTier, ["NONE", "BASIC", "BUSINESS", "HIGHER"] as const, "kycTier"),
    nationalIdNumber: row.nationalIdNumber,
    kraPin: row.kraPin,
  };
}

function oneOf<T extends string>(value: string, allowed: readonly T[], field: string): T {
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new Error(`stored ${field} is not a known value: ${value}`);
}

function methodFromDb(row: {
  id: string; businessId: string; currency: string; phone: string; accountName: string; status: string;
  lockedTradeId: string | null; coolingOffUntil: Date | null; verifiedAt: Date | null; otpHash: string | null; otpExpiresAt: Date | null;
}): PayoutMethodRecord {
  return {
    ...row,
    currency: row.currency as Currency,
    status: row.status as PayoutMethodRecord["status"],
    coolingOffUntil: row.coolingOffUntil?.toISOString() ?? null,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    otpExpiresAt: row.otpExpiresAt?.toISOString() ?? null,
  };
}

function invoiceFromDb(row: {
  id: string; businessId: string; status: string; corridorId: string; buyerName: string; buyerPhone: string; buyerCountry: string;
  networkCode: string | null; currency: string; itemsMinor: bigint; feeMinor: bigint; exporterNetMinor: bigint; buyerAmountMinor: bigint;
  midRate: string; spreadBps: number; quoteExpiresAt: Date; quoteSources: Prisma.JsonValue; notes: string | null;
  shippingDeadline: Date | null; disputeWindowHours: number | null; fingerprint: string; partnershipId: string | null; createdAt: Date;
  items: { id: string; description: string; quantity: number; unitMinor: bigint }[];
}): InvoiceRecord {
  return {
    ...row,
    status: row.status as InvoiceRecord["status"],
    currency: row.currency as Currency,
    quoteExpiresAt: row.quoteExpiresAt.toISOString(),
    quoteSources: Array.isArray(row.quoteSources) ? row.quoteSources.map(String) : [],
    shippingDeadline: row.shippingDeadline?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function tradeFromDb(row: {
  id: string; invoiceId: string; businessId: string; state: string; corridorId: string; buyerCurrency: string;
  itemsMinor: bigint; feeMinor: bigint; exporterNetMinor: bigint; quotedBuyerMinor: bigint; heldBuyerMinor: bigint;
  quoteExpiresAt: Date; invoiceDeadline: Date; disputeWindowEndsAt: Date | null; buyerName: string; buyerPhone: string;
  payoutMethodId: string; payoutIntent: string | null; attemptCount: number; deliveryCodeHash: string | null;
  shipWaybill: string | null; createdAt: Date; updatedAt: Date;
}): TradeRecord {
  return {
    ...row,
    state: row.state as TradeState,
    buyerCurrency: row.buyerCurrency as Currency,
    quoteExpiresAt: row.quoteExpiresAt.toISOString(),
    invoiceDeadline: row.invoiceDeadline.toISOString(),
    disputeWindowEndsAt: row.disputeWindowEndsAt?.toISOString() ?? null,
    payoutIntent: (row.payoutIntent as TradeRecord["payoutIntent"]) ?? "RELEASE",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function payoutFromDb(row: {
  id: string; tradeId: string; transactionReference: string; kind: string; status: string; currency: string;
  amountMinor: bigint; feeMinor: bigint; bankCode: string | null; accountNumber: string; accountName: string;
  failureConfirmed: boolean; lastError: string | null; rawResponse: Prisma.JsonValue;
}): PayoutRecord {
  return {
    ...row,
    kind: row.kind as PayoutRecord["kind"],
    status: row.status as PayoutRecord["status"],
    currency: row.currency as Currency,
    rawResponse: row.rawResponse,
  };
}

export function createPrismaClient(): PrismaClient {
  return new PrismaClient();
}
