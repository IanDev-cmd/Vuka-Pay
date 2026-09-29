import type { BuyerQuote, CollectionStatus, Money, NetworkOption, PayStatus } from "./types";

export class ApiError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  if (!headers.has("Accept-Language")) headers.set("Accept-Language", "en");
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (init?.method && init.method !== "GET" && !headers.has("Idempotency-Key")) {
    headers.set("Idempotency-Key", crypto.randomUUID());
  }
  const response = await fetch(path, { ...init, headers });
  const text = await response.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const error = isRecord(body) && isRecord(body.error) ? body.error : null;
    const code = typeof error?.code === "string" ? error.code : "REQUEST_FAILED";
    const message = typeof error?.message === "string" ? error.message : response.statusText;
    throw new ApiError(code, message, response.status);
  }
  return body as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function money(value: unknown): Money | null {
  if (!isRecord(value)) return null;
  const amount = value.amount_minor;
  const currency = value.currency;
  if (typeof amount !== "string" || (currency !== "KES" && currency !== "UGX" && currency !== "TZS")) return null;
  return { amount_minor: amount, currency };
}

function requireMoney(value: unknown, label: string): Money {
  const parsed = money(value);
  if (!parsed) throw new ApiError("VALIDATION_FAILED", `Pay link is missing ${label}`, 422);
  return parsed;
}

const COLLECTION: readonly CollectionStatus[] = ["INITIATED", "PENDING", "COMPLETED", "FAILED", "EXPIRED"];

export async function getPay(token: string): Promise<BuyerQuote> {
  const body = await request<unknown>(`/v1/pay/${encodeURIComponent(token)}`);
  if (!isRecord(body)) throw new ApiError("VALIDATION_FAILED", "Pay link returned an empty body", 422);
  const quote = isRecord(body.quote) ? body.quote : body;
  const invoice = isRecord(body.invoice) ? body.invoice : {};
  const fees = isRecord(quote.fee_breakdown) ? quote.fee_breakdown : isRecord(quote.fees) ? quote.fees : {};
  const collection = quote.buyer_amount ?? body.buyer_amount;
  const buyer = requireMoney(collection, "buyer_amount");
  if (buyer.currency !== "UGX" && buyer.currency !== "TZS") {
    throw new ApiError("VALIDATION_FAILED", "Buyer currency is not UGX or TZS", 422);
  }
  const goods = money(fees.items) ?? money(fees.goods) ?? money(quote.kes_total) ?? money(body.kes_total);
  if (!goods) throw new ApiError("VALIDATION_FAILED", "Pay link is missing the KES amounts", 422);
  const net = money(quote.exporter_net) ?? money(fees.exporter_net) ?? money(body.exporter_net);
  const networks = readNetworks(body.networks ?? quote.networks);
  const invoiceNumber =
    typeof invoice.number === "string"
      ? invoice.number
      : typeof body.invoice_number === "string"
        ? body.invoice_number
        : typeof body.invoice_id === "string"
          ? body.invoice_id
          : typeof invoice.id === "string"
            ? invoice.id
            : "";
  const parties = isRecord(body.parties) ? body.parties : {};
  const exporterParty = isRecord(parties.exporter) ? parties.exporter : {};
  const exporter =
    typeof body.exporter_display_name === "string"
      ? body.exporter_display_name
      : typeof invoice.exporter_display_name === "string"
        ? invoice.exporter_display_name
        : typeof exporterParty.display_name === "string"
          ? exporterParty.display_name
          : "";
  const spread = typeof quote.spread_bps === "number" ? quote.spread_bps : null;
  const expires =
    typeof quote.expires_at === "string"
      ? quote.expires_at
      : typeof quote.quote_expires_at === "string"
        ? quote.quote_expires_at
        : typeof body.quote_expires_at === "string"
          ? body.quote_expires_at
          : null;
  const rate = typeof quote.rate === "string" ? quote.rate : quote.rate != null ? String(quote.rate) : null;
  return {
    invoice_number: invoiceNumber,
    exporter_name: exporter,
    buyer_amount: buyer,
    exporter_receives: goods,
    exporter_net: net,
    fee_subline: money(fees.vukapay_fee),
    rate,
    expires_at: expires,
    collection_currency: buyer.currency,
    fees: {
      goods,
      vukapay_fee: money(fees.vukapay_fee),
      payaza_processing_fee: money(fees.payaza_processing_fee) ?? money(fees.payaza_fee),
      spread_bps: spread,
    },
    networks,
  };
}

function readNetworks(value: unknown): NetworkOption[] {
  if (!Array.isArray(value)) return [];
  const networks: NetworkOption[] = [];
  for (const row of value) {
    if (!isRecord(row) || typeof row.code !== "string") continue;
    const display =
      typeof row.display_name === "string"
        ? row.display_name
        : typeof row.displayName === "string"
          ? row.displayName
          : row.code;
    networks.push({ code: row.code, display_name: display });
  }
  return networks;
}

export async function refreshQuote(token: string): Promise<BuyerQuote> {
  await request(`/v1/pay/${encodeURIComponent(token)}/quote/refresh`, { method: "POST" });
  return getPay(token);
}

export async function collect(token: string, phone: string, networkCode: string): Promise<{ expires_at: string | null }> {
  const body = await request<unknown>(`/v1/pay/${encodeURIComponent(token)}/collect`, {
    method: "POST",
    body: JSON.stringify({ phone, network_code: networkCode }),
  });
  const expires = isRecord(body) && typeof body.expires_at === "string" ? body.expires_at : null;
  return { expires_at: expires };
}

export async function retryCollection(token: string): Promise<void> {
  await request(`/v1/pay/${encodeURIComponent(token)}/retry`, { method: "POST" });
}

export async function getPayStatus(token: string): Promise<PayStatus> {
  const body = await request<unknown>(`/v1/pay/${encodeURIComponent(token)}/status`);
  if (!isRecord(body)) return { collection_status: null, trade_state: null };
  const collection = isRecord(body.collection) ? body.collection : body;
  const trade = isRecord(body.trade) ? body.trade : body;
  const rawStatus = typeof collection.status === "string" ? collection.status : null;
  const collection_status = COLLECTION.includes(rawStatus as CollectionStatus) ? (rawStatus as CollectionStatus) : null;
  const trade_state = typeof trade.state === "string" ? trade.state : typeof body.trade_state === "string" ? body.trade_state : null;
  return { collection_status, trade_state };
}

export interface CorridorMeta {
  currency: "UGX" | "TZS";
  networks: NetworkOption[];
}

export async function getCorridors(): Promise<CorridorMeta[]> {
  const body = await request<unknown>("/v1/meta/corridors");
  const rows = Array.isArray(body) ? body : isRecord(body) && Array.isArray(body.corridors) ? body.corridors : [];
  const corridors: CorridorMeta[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const currency = row.collection_currency ?? row.currency;
    if (currency !== "UGX" && currency !== "TZS") continue;
    corridors.push({ currency, networks: readNetworks(row.networks) });
  }
  return corridors;
}

export interface InvoiceDraft {
  items: { description: string; quantity: number; unit: Money }[];
  buyer: { name: string; phone: string; country: "UG" | "TZ"; network: string; currency: "UGX" | "TZS" };
  notes?: string;
  shipping_deadline?: string;
  dispute_window_hours?: number;
}

export async function createInvoice(draft: InvoiceDraft): Promise<{ id: string; quote: BuyerQuote | null }> {
  const body = await request<unknown>("/v1/invoices", {
    method: "POST",
    body: JSON.stringify({
      items: draft.items.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unit_amount_minor: item.unit.amount_minor,
      })),
      buyer: draft.buyer,
      notes: draft.notes,
      shipping_deadline: draft.shipping_deadline,
      dispute_window_hours: draft.dispute_window_hours,
    }),
  });
  if (!isRecord(body) || typeof body.id !== "string") {
    throw new ApiError("VALIDATION_FAILED", "Invoice response did not include an id", 422);
  }
  let quote: BuyerQuote | null = null;
  try {
    quote = quoteFromInvoice(body);
  } catch {
    quote = null;
  }
  return { id: body.id, quote };
}

function quoteFromInvoice(body: Record<string, unknown>): BuyerQuote {
  const buyer = requireMoney(body.buyer_amount, "buyer_amount");
  if (buyer.currency !== "UGX" && buyer.currency !== "TZS") {
    throw new ApiError("VALIDATION_FAILED", "Buyer currency is not UGX or TZS", 422);
  }
  const goods = requireMoney(body.kes_total ?? body.items_total, "kes_total");
  const net = money(body.exporter_net);
  const fees = isRecord(body.fee_breakdown) ? body.fee_breakdown : {};
  return {
    invoice_number: typeof body.number === "string" ? body.number : typeof body.id === "string" ? body.id : "",
    exporter_name: typeof body.exporter_display_name === "string" ? body.exporter_display_name : "",
    buyer_amount: buyer,
    exporter_receives: goods,
    exporter_net: net,
    fee_subline: money(fees.vukapay_fee),
    rate: typeof body.rate === "string" ? body.rate : null,
    expires_at: typeof body.quote_expires_at === "string" ? body.quote_expires_at : null,
    collection_currency: buyer.currency,
    fees: {
      goods,
      vukapay_fee: money(fees.vukapay_fee),
      payaza_processing_fee: money(fees.payaza_processing_fee),
      spread_bps: typeof body.spread_bps === "number" ? body.spread_bps : null,
    },
    networks: [],
  };
}

export async function sendInvoice(id: string): Promise<void> {
  await request(`/v1/invoices/${encodeURIComponent(id)}/send`, { method: "POST" });
}

export async function listTrades(): Promise<{ id: string; state: string }[]> {
  const body = await request<unknown>("/v1/trades");
  const rows = Array.isArray(body) ? body : isRecord(body) && Array.isArray(body.data) ? body.data : [];
  return rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== "string") return [];
    return [{ id: row.id, state: typeof row.state === "string" ? row.state : "" }];
  });
}

export interface PayoutListItem {
  id: string;
  status: string;
  transaction_reference: string | null;
  trade_id: string | null;
  amount: Money | null;
}

export async function listPayouts(): Promise<PayoutListItem[]> {
  const body = await request<unknown>("/v1/payouts");
  const rows = Array.isArray(body) ? body : isRecord(body) && Array.isArray(body.data) ? body.data : [];
  return rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== "string") return [];
    return [
      {
        id: row.id,
        status: typeof row.status === "string" ? row.status : "",
        transaction_reference: typeof row.transaction_reference === "string" ? row.transaction_reference : null,
        trade_id: typeof row.trade_id === "string" ? row.trade_id : null,
        amount: money(row.amount),
      },
    ];
  });
}

export interface WalletBalance {
  in_hold: Money | null;
  paid_out: Money | null;
  pending_payout: Money | null;
}

export async function getBalance(): Promise<WalletBalance> {
  const body = await request<unknown>("/v1/balance");
  const row = isRecord(body) ? body : {};
  return {
    in_hold: firstMoney(row.in_hold),
    paid_out: firstMoney(row.paid_out),
    pending_payout: firstMoney(row.pending_payout),
  };
}

function firstMoney(value: unknown): Money | null {
  if (!Array.isArray(value)) return null;
  return money(value[0]);
}
