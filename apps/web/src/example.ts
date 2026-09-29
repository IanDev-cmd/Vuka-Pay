import { CORRIDOR_NETWORKS } from "./networks";
import type { BuyerQuote } from "./types";

/**
 * Figures from the checkout brief. They are replaced by GET /v1/pay/:token
 * and by the invoice preview quote. 45,000 KES × 29.53 = 1,328,850 UGX.
 * Exporter net 44,100 leaves a 900 KES fee.
 */
export function placeholderQuote(now = Date.now()): BuyerQuote {
  return {
    invoice_number: "INV-1042",
    exporter_name: "Exporter name",
    buyer_amount: { amount_minor: "1328850", currency: "UGX" },
    exporter_receives: { amount_minor: "4500000", currency: "KES" },
    exporter_net: { amount_minor: "4410000", currency: "KES" },
    fee_subline: { amount_minor: "90000", currency: "KES" },
    rate: "29.53",
    expires_at: new Date(now + (14 * 60 + 32) * 1000).toISOString(),
    collection_currency: "UGX",
    fees: {
      goods: { amount_minor: "4500000", currency: "KES" },
      vukapay_fee: { amount_minor: "90000", currency: "KES" },
      payaza_processing_fee: null,
      spread_bps: null,
    },
    networks: CORRIDOR_NETWORKS.UGX,
  };
}
