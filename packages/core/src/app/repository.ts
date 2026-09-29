import type { Currency } from "../money.js";
import type { TradeState, PayoutIntent } from "../escrow.js";
import type { Journal } from "../ledger.js";
import type { CollectionNetwork } from "../corridors.js";

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  role: "EXPORTER" | "ADMIN" | "AGENT";
  displayName: string;
  phone: string | null;
  language: "en" | "sw";
  createdAt: string;
}

export interface RefreshRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface BusinessRecord {
  id: string;
  userId: string;
  legalName: string;
  tradingName: string;
  country: string;
  kycTier: "NONE" | "BASIC" | "BUSINESS" | "HIGHER";
  nationalIdNumber: string | null;
  kraPin: string | null;
}

export interface PayoutMethodRecord {
  id: string;
  businessId: string;
  currency: Currency;
  phone: string;
  accountName: string;
  status: "UNVERIFIED" | "OTP_SENT" | "VERIFIED" | "LOCKED" | "COOLING_OFF";
  lockedTradeId: string | null;
  coolingOffUntil: string | null;
  verifiedAt: string | null;
  otpHash: string | null;
  otpExpiresAt: string | null;
}

export interface InvoiceRecord {
  id: string;
  businessId: string;
  status: "DRAFT" | "INVOICED" | "CANCELLED";
  corridorId: string;
  buyerName: string;
  buyerPhone: string;
  buyerCountry: string;
  networkCode: string | null;
  currency: Currency;
  itemsMinor: bigint;
  feeMinor: bigint;
  exporterNetMinor: bigint;
  buyerAmountMinor: bigint;
  midRate: string;
  spreadBps: number;
  quoteExpiresAt: string;
  quoteSources: string[];
  notes: string | null;
  shippingDeadline: string | null;
  disputeWindowHours: number | null;
  fingerprint: string;
  partnershipId: string | null;
  items: { id: string; description: string; quantity: number; unitMinor: bigint }[];
  createdAt: string;
}

export interface TradeRecord {
  id: string;
  invoiceId: string;
  businessId: string;
  state: TradeState;
  corridorId: string;
  buyerCurrency: Currency;
  itemsMinor: bigint;
  feeMinor: bigint;
  exporterNetMinor: bigint;
  quotedBuyerMinor: bigint;
  heldBuyerMinor: bigint;
  quoteExpiresAt: string;
  invoiceDeadline: string;
  disputeWindowEndsAt: string | null;
  buyerName: string;
  buyerPhone: string;
  payoutMethodId: string;
  payoutIntent: PayoutIntent;
  attemptCount: number;
  deliveryCodeHash: string | null;
  shipWaybill: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TradeEventRecord {
  id: string;
  tradeId: string;
  fromState: string;
  toState: string;
  command: string;
  actor: string;
  reason: string;
  payloadHash: string;
  effects: string[];
  createdAt: string;
}

export interface CollectionRecord {
  id: string;
  tradeId: string;
  transactionReference: string;
  networkCode: string;
  phone: string;
  status: "INITIATED" | "PENDING" | "COMPLETED" | "FAILED" | "EXPIRED";
  amountMinor: bigint;
  currency: Currency;
  rawResponse: unknown;
}

export interface PayoutRecord {
  id: string;
  tradeId: string;
  transactionReference: string;
  kind: "RELEASE" | "REFUND" | "SPLIT_EXPORTER" | "SPLIT_BUYER";
  status: "INITIATED" | "PENDING" | "SUCCEEDED" | "FAILED" | "REVERSED";
  currency: Currency;
  amountMinor: bigint;
  feeMinor: bigint;
  bankCode: string | null;
  accountNumber: string;
  accountName: string;
  failureConfirmed: boolean;
  lastError: string | null;
  rawResponse: unknown;
}

export interface LedgerBalance {
  account: string;
  currency: Currency;
  debitMinor: bigint;
  creditMinor: bigint;
}

export interface Repository {
  transaction<T>(work: (repo: Repository) => Promise<T>): Promise<T>;
  saveUser(user: UserRecord): Promise<void>;
  userByEmail(email: string): Promise<UserRecord | null>;
  userById(id: string): Promise<UserRecord | null>;
  saveRefresh(row: RefreshRecord): Promise<void>;
  refreshByHash(hash: string): Promise<RefreshRecord | null>;
  saveBusiness(row: BusinessRecord): Promise<void>;
  businessByUser(userId: string): Promise<BusinessRecord | null>;
  businessById(id: string): Promise<BusinessRecord | null>;
  savePayoutMethod(row: PayoutMethodRecord): Promise<void>;
  payoutMethods(businessId: string): Promise<PayoutMethodRecord[]>;
  payoutMethod(id: string): Promise<PayoutMethodRecord | null>;
  saveInvoice(row: InvoiceRecord): Promise<void>;
  invoice(id: string): Promise<InvoiceRecord | null>;
  invoices(businessId: string): Promise<InvoiceRecord[]>;
  fingerprints(businessId: string): Promise<string[]>;
  saveTrade(row: TradeRecord): Promise<void>;
  trade(id: string): Promise<TradeRecord | null>;
  tradeByInvoice(invoiceId: string): Promise<TradeRecord | null>;
  trades(filter?: { businessId?: string; state?: string; corridorId?: string }): Promise<TradeRecord[]>;
  appendEvent(row: TradeEventRecord): Promise<void>;
  events(tradeId: string): Promise<TradeEventRecord[]>;
  saveCollection(row: CollectionRecord): Promise<void>;
  collectionByReference(reference: string): Promise<CollectionRecord | null>;
  collections(tradeId: string): Promise<CollectionRecord[]>;
  savePayout(row: PayoutRecord): Promise<void>;
  payout(id: string): Promise<PayoutRecord | null>;
  payoutByReference(reference: string): Promise<PayoutRecord | null>;
  payouts(filter?: { tradeId?: string; businessId?: string }): Promise<PayoutRecord[]>;
  postJournal(journal: Journal): Promise<void>;
  ledgerBalances(): Promise<LedgerBalance[]>;
  countPayoutsSince(businessId: string, sinceIso: string): Promise<number>;
  succeededPayoutCount(businessId: string): Promise<number>;
  openInvoiceMinor(businessId: string): Promise<bigint>;
  saveIdempotency(row: {
    key: string;
    userScope: string;
    method: string;
    path: string;
    requestHash: string;
    statusCode: number;
    responseBody: unknown;
  }): Promise<void>;
  idempotency(key: string, userScope: string, method: string, path: string): Promise<{
    requestHash: string;
    statusCode: number;
    responseBody: unknown;
  } | null>;
  savePayazaEvent(row: {
    id: string;
    rawBody: string;
    signatureOk: boolean;
    transactionReference: string | null;
    dedupeKey: string | null;
  }): Promise<void>;
  unprocessedPayazaEvents(): Promise<{ id: string; rawBody: string; dedupeKey: string | null }[]>;
  markPayazaEvent(id: string, error: string | null): Promise<void>;
  saveDispute(row: { id: string; tradeId: string; reason: string; status: string; decision: string | null; note: string | null }): Promise<void>;
  disputes(): Promise<{ id: string; tradeId: string; reason: string; status: string; decision: string | null; note: string | null }[]>;
  dispute(id: string): Promise<{ id: string; tradeId: string; reason: string; status: string; decision: string | null; note: string | null } | null>;
  saveProof(row: { id: string; tradeId: string; kind: string; objectKey: string | null; waybillNo: string | null; note: string | null }): Promise<void>;
  savePartnership(row: PartnershipRecord): Promise<void>;
  partnerships(businessId: string): Promise<PartnershipRecord[]>;
  partnership(id: string): Promise<PartnershipRecord | null>;
  saveRecord(row: {
    id: string;
    tradeId: string;
    businessId: string;
    corridorId: string;
    terminalState: string;
    counterpartyKey: string;
    amountKesMinor: bigint;
    onTime: boolean | null;
    disputed: boolean;
    disputeOutcome: string | null;
    completedAt: string;
  }): Promise<void>;
  records(businessId: string): Promise<{
    id: string;
    tradeId: string;
    terminalState: "PAID_OUT" | "REFUNDED" | "CANCELLED" | "EXPIRED" | "PAYMENT_FAILED";
    corridor: string;
    onTime: boolean | null;
    disputed: boolean;
    disputeOutcome: "RELEASE" | "REFUND" | "SPLIT" | null;
    counterpartyKey: string;
    completedAt: Date;
    amountKesMinor: bigint;
  }[]>;
  saveConsent(row: { id: string; businessId: string; lenderName: string; tokenHash: string; expiresAt: string; revokedAt: string | null }): Promise<void>;
  consents(businessId: string): Promise<{ id: string; lenderName: string; expiresAt: string; revokedAt: string | null }[]>;
  revokeConsent(id: string, businessId: string): Promise<void>;
  audit(row: { id: string; actorId: string; action: string; target: string; payload: unknown }): Promise<void>;
  saveTreasury(row: {
    id: string;
    sellCurrency: Currency;
    sellMinor: bigint;
    buyCurrency: Currency;
    buyMinor: bigint;
    rate: string;
    counterparty: string;
    evidenceRef: string;
    actorId: string;
  }): Promise<void>;
  treasury(): Promise<{
    id: string;
    sellCurrency: string;
    sellMinor: bigint;
    buyCurrency: string;
    buyMinor: bigint;
    rate: string;
    counterparty: string;
    evidenceRef: string;
    createdAt: string;
  }[]>;
  saveKyc(row: { id: string; businessId: string; kind: string; objectKey: string }): Promise<void>;
  kyc(businessId: string): Promise<{ id: string; kind: string; objectKey: string }[]>;
  saveNotification(row: { id: string; channel: string; toMasked: string; template: string; status: string }): Promise<void>;
  flags(): Promise<Record<string, boolean>>;
  setFlag(key: string, enabled: boolean): Promise<void>;
}

export interface PartnershipRecord {
  id: string;
  businessId: string;
  partnerCode: string;
  buyerName: string;
  buyerPhone: string;
  buyerCountry: string;
  networkCode: string | null;
  currency: Currency;
}

export interface Rails {
  processCollection(input: {
    amount: number;
    customer_number: string;
    transaction_reference: string;
    transaction_description: string;
    customer_bank_code: string;
    currency_code: string;
    customer_email: string;
    customer_first_name: string;
    customer_last_name: string;
    customer_phone_number: string;
    country_code: string;
  }): Promise<{ response_code: string; response_message?: string; payment_completion_url?: string }>;
  checkCollection(reference: string, countryCode: string): Promise<{ response_code: string; transaction_status?: string }>;
  initiatePayout(input: {
    transaction_type: string;
    pin: string;
    account_reference: string;
    currency: string;
    country: string;
    credit_amount: number;
    account_number: string;
    account_name: string;
    bank_code: string;
    narration: string;
    transaction_reference: string;
    sender_name: string;
    sender_phone_number: string;
    sender_address: string;
  }): Promise<{ response_status?: string; batch_reference?: string; raw: unknown }>;
  payoutStatus(reference: string): Promise<{ transactionStatus?: string; fee?: number; raw: unknown }>;
  kesAccount(): Promise<{ payazaAccountReference: string; postNoDebit: boolean; accountBalance: number; currency: string } | null>;
  kesMobileMoneyCode(pinned: string | undefined): Promise<string>;
  fundTest(reference: string, countryCode: string): Promise<{ response_code: string; response_message?: string }>;
}

export interface Notifier {
  sms(to: string, body: string): Promise<void>;
}

export interface ServiceConfig {
  appSecret: string;
  spreadBps: number;
  quoteTtlSeconds: number;
  maxDeviationBps: number;
  maxRateAgeSeconds: number;
  feeBps: number;
  feeMinMinor: bigint;
  feeMaxMinor: bigint;
  settlementMode: "none" | "treasury_float";
  maxOpenExposureMinor: bigint;
  maxInvoiceKesMinor: bigint;
  firstPayoutKesMinor: bigint;
  maxPayoutsPerDay: number;
  coolingSeconds: number;
  collectionNetworks: CollectionNetwork[];
  kesMomoBankCode?: string;
  transactionPin?: string;
  smsConfigured: boolean;
  creditEnabled: boolean;
  creditMinRecords: number;
  disputeWindowSeconds: number;
  tenant: "test" | "live";
}
