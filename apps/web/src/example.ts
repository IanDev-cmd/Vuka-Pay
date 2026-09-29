import { DEMO_GOODS_MINOR, DEMO_QUOTE_CONFIG, quoteMock } from "@vukapay/core/fx";
import { CORRIDOR_NETWORKS } from "./networks";
import type { BuyerQuote, CurrencyCode } from "./types";

export const DEMO_TRADES = [
  { id: "demo-ug", state: "AWAITING_PAYMENT" },
  { id: "demo-tz", state: "FUNDED" },
  { id: "demo-rw", state: "SHIPPED" },
  { id: "demo-ke", state: "PAYMENT_PENDING" },
] as const;

export function corridorOfDemo(id: string | null): "KE-KE" | "KE-UG" | "KE-TZ" | "KE-RW" {
  if (id === "demo-tz") return "KE-TZ";
  if (id === "demo-rw") return "KE-RW";
  if (id === "demo-ke") return "KE-KE";
  return "KE-UG";
}

function currencyOf(corridor: "KE-KE" | "KE-UG" | "KE-TZ" | "KE-RW"): CurrencyCode {
  if (corridor === "KE-TZ") return "TZS";
  if (corridor === "KE-RW") return "RWF";
  if (corridor === "KE-KE") return "KES";
  return "UGX";
}

/** Demo invoice priced by the quote engine on the mock USD book. */
export function placeholderQuote(
  corridor: "KE-KE" | "KE-UG" | "KE-TZ" | "KE-RW" = "KE-UG",
  itemsMinor: bigint = DEMO_GOODS_MINOR,
  now = Date.now(),
): BuyerQuote {
  const currency = currencyOf(corridor);
  const quote = quoteMock({ itemsMinor, to: currency, now: new Date(now), config: DEMO_QUOTE_CONFIG });
  const goods = quote.itemsMinor.toString();
  return {
    invoice_number: "INV-1042",
    exporter_name: "Amina Traders",
    buyer_amount: { amount_minor: quote.buyerAmountMinor.toString(), currency },
    exporter_receives: { amount_minor: goods, currency: "KES" },
    exporter_net: { amount_minor: quote.exporterNetKesMinor.toString(), currency: "KES" },
    fee_subline: { amount_minor: quote.feeMinor.toString(), currency: "KES" },
    rate: quote.midRate,
    expires_at: quote.expiresAt.toISOString(),
    collection_currency: currency,
    fees: {
      goods: { amount_minor: goods, currency: "KES" },
      vukapay_fee: { amount_minor: quote.feeMinor.toString(), currency: "KES" },
      payaza_processing_fee: null,
      spread_bps: quote.spreadBps,
    },
    networks: [...CORRIDOR_NETWORKS[currency]],
  };
}
