export type CurrencyCode = "KES" | "UGX" | "TZS" | "RWF";

export interface Money {
  amount_minor: string;
  currency: CurrencyCode;
}

export interface NetworkOption {
  /** Payaza customer_bank_code. Null until GET /v1/meta/corridors or the pay link supplies one. */
  code: string | null;
  display_name: string;
}

export interface FeeLines {
  goods: Money;
  vukapay_fee: Money | null;
  /** Payaza's transaction_fee is recorded on settlement. Null until the API returns it. */
  payaza_processing_fee: Money | null;
  spread_bps: number | null;
}

/** Locked quote shown on the buyer card. Amounts come from GET /v1/pay/:token. */
export interface BuyerQuote {
  invoice_number: string;
  exporter_name: string;
  buyer_amount: Money;
  /** KES goods amount shown as "Exporter receives". */
  exporter_receives: Money;
  /** KES amount after the VukaPay fee. Null until the quote includes it. */
  exporter_net: Money | null;
  fee_subline: Money | null;
  /** Buyer-currency major units per 1 KES. */
  rate: string | null;
  expires_at: string | null;
  collection_currency: "KES" | "UGX" | "TZS" | "RWF";
  fees: FeeLines;
  networks: NetworkOption[];
}

export type CollectionStatus = "INITIATED" | "PENDING" | "COMPLETED" | "FAILED" | "EXPIRED";

export interface PayStatus {
  collection_status: CollectionStatus | null;
  trade_state: string | null;
  in_hold: Money | null;
}
