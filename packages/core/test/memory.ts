import type { Journal } from "../src/ledger.js";
import type {
  BusinessRecord,
  CollectionRecord,
  InvoiceRecord,
  PartnershipRecord,
  PayoutMethodRecord,
  PayoutRecord,
  RefreshRecord,
  Repository,
  TradeEventRecord,
  TradeRecord,
  UserRecord,
} from "../src/app/repository.js";

interface State {
  users: UserRecord[];
  refreshes: RefreshRecord[];
  businesses: BusinessRecord[];
  methods: PayoutMethodRecord[];
  invoices: InvoiceRecord[];
  trades: TradeRecord[];
  events: TradeEventRecord[];
  collections: CollectionRecord[];
  payouts: PayoutRecord[];
  journals: Journal[];
  idempotency: { key: string; userScope: string; method: string; path: string; requestHash: string; statusCode: number; responseBody: unknown }[];
  payazaEvents: { id: string; rawBody: string; signatureOk: boolean; transactionReference: string | null; dedupeKey: string | null; processedAt: string | null; processError: string | null }[];
  disputes: { id: string; tradeId: string; reason: string; status: string; decision: string | null; note: string | null }[];
  proofs: { id: string; tradeId: string; kind: string; objectKey: string | null; waybillNo: string | null; note: string | null }[];
  partnerships: PartnershipRecord[];
  records: {
    id: string;
    tradeId: string;
    businessId: string;
    corridorId: string;
    terminalState: "PAID_OUT" | "REFUNDED" | "CANCELLED" | "EXPIRED" | "PAYMENT_FAILED";
    counterpartyKey: string;
    amountKesMinor: bigint;
    onTime: boolean | null;
    disputed: boolean;
    disputeOutcome: "RELEASE" | "REFUND" | "SPLIT" | null;
    completedAt: string;
  }[];
  consents: { id: string; businessId: string; lenderName: string; tokenHash: string; expiresAt: string; revokedAt: string | null }[];
  audits: { id: string; actorId: string; action: string; target: string; payload: unknown }[];
  treasury: { id: string; sellCurrency: string; sellMinor: bigint; buyCurrency: string; buyMinor: bigint; rate: string; counterparty: string; evidenceRef: string; createdAt: string }[];
  kyc: { id: string; businessId: string; kind: string; objectKey: string }[];
  notifications: { id: string; channel: string; toMasked: string; template: string; status: string }[];
  flags: Record<string, boolean>;
}

function empty(): State {
  return {
    users: [],
    refreshes: [],
    businesses: [],
    methods: [],
    invoices: [],
    trades: [],
    events: [],
    collections: [],
    payouts: [],
    journals: [],
    idempotency: [],
    payazaEvents: [],
    disputes: [],
    proofs: [],
    partnerships: [],
    records: [],
    consents: [],
    audits: [],
    treasury: [],
    kyc: [],
    notifications: [],
    flags: {},
  };
}

export class MemoryRepository implements Repository {
  state: State = empty();

  async transaction<T>(work: (repo: Repository) => Promise<T>): Promise<T> {
    const snapshot = structuredClone(this.state);
    try {
      return await work(this);
    } catch (error) {
      this.state = snapshot;
      throw error;
    }
  }

  async saveUser(user: UserRecord) {
    this.upsert(this.state.users, user);
  }
  async userByEmail(email: string) {
    return this.state.users.find((row) => row.email === email) ?? null;
  }
  async userById(id: string) {
    return this.state.users.find((row) => row.id === id) ?? null;
  }
  async saveRefresh(row: RefreshRecord) {
    this.upsert(this.state.refreshes, row);
  }
  async refreshByHash(hash: string) {
    return this.state.refreshes.find((row) => row.tokenHash === hash) ?? null;
  }
  async saveBusiness(row: BusinessRecord) {
    this.upsert(this.state.businesses, row);
  }
  async businessByUser(userId: string) {
    return this.state.businesses.find((row) => row.userId === userId) ?? null;
  }
  async businessById(id: string) {
    return this.state.businesses.find((row) => row.id === id) ?? null;
  }
  async savePayoutMethod(row: PayoutMethodRecord) {
    this.upsert(this.state.methods, row);
  }
  async payoutMethods(businessId: string) {
    return this.state.methods.filter((row) => row.businessId === businessId);
  }
  async payoutMethod(id: string) {
    return this.state.methods.find((row) => row.id === id) ?? null;
  }
  async saveInvoice(row: InvoiceRecord) {
    this.upsert(this.state.invoices, row);
  }
  async invoice(id: string) {
    return this.state.invoices.find((row) => row.id === id) ?? null;
  }
  async invoices(businessId: string) {
    return this.state.invoices.filter((row) => row.businessId === businessId);
  }
  async fingerprints(businessId: string) {
    return this.state.invoices.filter((row) => row.businessId === businessId && row.status !== "CANCELLED").map((row) => row.fingerprint);
  }
  async saveTrade(row: TradeRecord) {
    this.upsert(this.state.trades, row);
  }
  async trade(id: string) {
    return this.state.trades.find((row) => row.id === id) ?? null;
  }
  async tradeByInvoice(invoiceId: string) {
    return this.state.trades.find((row) => row.invoiceId === invoiceId) ?? null;
  }
  async trades(filter?: { businessId?: string; state?: string; corridorId?: string }) {
    return this.state.trades.filter((row) => {
      if (filter?.businessId && row.businessId !== filter.businessId) return false;
      if (filter?.state && row.state !== filter.state) return false;
      if (filter?.corridorId && row.corridorId !== filter.corridorId) return false;
      return true;
    });
  }
  async appendEvent(row: TradeEventRecord) {
    this.state.events.push(row);
  }
  async events(tradeId: string) {
    return this.state.events.filter((row) => row.tradeId === tradeId);
  }
  async saveCollection(row: CollectionRecord) {
    this.upsert(this.state.collections, row);
  }
  async collectionByReference(reference: string) {
    return this.state.collections.find((row) => row.transactionReference === reference) ?? null;
  }
  async collections(tradeId: string) {
    return this.state.collections.filter((row) => row.tradeId === tradeId);
  }
  async savePayout(row: PayoutRecord) {
    this.upsert(this.state.payouts, row);
  }
  async payout(id: string) {
    return this.state.payouts.find((row) => row.id === id) ?? null;
  }
  async payoutByReference(reference: string) {
    return this.state.payouts.find((row) => row.transactionReference === reference) ?? null;
  }
  async payouts(filter?: { tradeId?: string; businessId?: string }) {
    return this.state.payouts.filter((row) => {
      if (filter?.tradeId && row.tradeId !== filter.tradeId) return false;
      if (filter?.businessId) {
        const trade = this.state.trades.find((item) => item.id === row.tradeId);
        if (!trade || trade.businessId !== filter.businessId) return false;
      }
      return true;
    });
  }
  async postJournal(journal: Journal) {
    this.state.journals.push(journal);
  }
  async ledgerBalances() {
    const map = new Map<string, { account: string; currency: Journal["lines"][number]["currency"]; debitMinor: bigint; creditMinor: bigint }>();
    for (const journal of this.state.journals) {
      for (const line of journal.lines) {
        const key = `${line.account}:${line.currency}`;
        const bucket = map.get(key) ?? { account: line.account, currency: line.currency, debitMinor: 0n, creditMinor: 0n };
        bucket.debitMinor += line.debitMinor;
        bucket.creditMinor += line.creditMinor;
        map.set(key, bucket);
      }
    }
    return [...map.values()];
  }
  async countPayoutsSince(businessId: string, sinceIso: string) {
    return (await this.payouts({ businessId })).length;
  }
  async succeededPayoutCount(businessId: string) {
    return (await this.payouts({ businessId })).filter((row) => row.status === "SUCCEEDED").length;
  }
  async openInvoiceMinor(businessId: string) {
    return this.state.invoices
      .filter((row) => row.businessId === businessId && row.status !== "CANCELLED")
      .reduce((sum, row) => sum + row.itemsMinor, 0n);
  }
  async saveIdempotency(row: State["idempotency"][number]) {
    this.state.idempotency.push(row);
  }
  async idempotency(key: string, userScope: string, method: string, path: string) {
    return this.state.idempotency.find((row) => row.key === key && row.userScope === userScope && row.method === method && row.path === path) ?? null;
  }
  async savePayazaEvent(row: { id: string; rawBody: string; signatureOk: boolean; transactionReference: string | null; dedupeKey: string | null }) {
    this.state.payazaEvents.push({ ...row, processedAt: null, processError: null });
  }
  async unprocessedPayazaEvents() {
    return this.state.payazaEvents.filter((row) => !row.processedAt && row.signatureOk);
  }
  async markPayazaEvent(id: string, error: string | null) {
    const row = this.state.payazaEvents.find((item) => item.id === id);
    if (row) {
      row.processedAt = new Date().toISOString();
      row.processError = error;
    }
  }
  async saveDispute(row: State["disputes"][number]) {
    this.upsert(this.state.disputes, row);
  }
  async disputes() {
    return this.state.disputes;
  }
  async dispute(id: string) {
    return this.state.disputes.find((row) => row.id === id) ?? null;
  }
  async saveProof(row: State["proofs"][number]) {
    this.state.proofs.push(row);
  }
  async savePartnership(row: PartnershipRecord) {
    this.upsert(this.state.partnerships, row);
  }
  async partnerships(businessId: string) {
    return this.state.partnerships.filter((row) => row.businessId === businessId);
  }
  async partnership(id: string) {
    return this.state.partnerships.find((row) => row.id === id) ?? null;
  }
  async saveRecord(row: State["records"][number]) {
    this.state.records.push(row);
  }
  async records(businessId: string) {
    return this.state.records.filter((row) => row.businessId === businessId).map((row) => ({
      ...row,
      corridor: row.corridorId,
      completedAt: new Date(row.completedAt),
    }));
  }
  async saveConsent(row: State["consents"][number]) {
    this.upsert(this.state.consents, row);
  }
  async consents(businessId: string) {
    return this.state.consents.filter((row) => row.businessId === businessId);
  }
  async revokeConsent(id: string, businessId: string) {
    const row = this.state.consents.find((item) => item.id === id && item.businessId === businessId);
    if (row) row.revokedAt = new Date().toISOString();
  }
  async audit(row: State["audits"][number]) {
    this.state.audits.push(row);
  }
  async saveTreasury(row: Omit<State["treasury"][number], "createdAt">) {
    this.state.treasury.push({ ...row, createdAt: new Date().toISOString() });
  }
  async treasury() {
    return this.state.treasury;
  }
  async saveKyc(row: State["kyc"][number]) {
    this.state.kyc.push(row);
  }
  async kyc(businessId: string) {
    return this.state.kyc.filter((row) => row.businessId === businessId);
  }
  async saveNotification(row: State["notifications"][number]) {
    this.state.notifications.push(row);
  }
  async flags() {
    return this.state.flags;
  }
  async setFlag(key: string, enabled: boolean) {
    this.state.flags[key] = enabled;
  }

  private upsert<T extends { id: string }>(rows: T[], row: T) {
    const index = rows.findIndex((item) => item.id === row.id);
    if (index >= 0) rows[index] = row;
    else rows.push(row);
  }
}
