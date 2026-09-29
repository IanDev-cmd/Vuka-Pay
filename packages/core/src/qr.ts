/**
 * Dynamic buyer-payment payload rendered as a QR code.
 * payazaCheckoutUrl is set only when Payaza returns payment_completion_url.
 */
export interface PaymentQrPayload {
  invoiceId: string;
  tradeId: string;
  payToken: string;
  corridor: string;
  settlementCurrency: string;
  amount: string;
  payazaCheckoutUrl: string | null;
}

export function paymentQrText(payload: PaymentQrPayload): string {
  return JSON.stringify({
    v: 1,
    invoiceId: payload.invoiceId,
    tradeId: payload.tradeId,
    payToken: payload.payToken,
    corridor: payload.corridor,
    settlementCurrency: payload.settlementCurrency,
    amount: payload.amount,
    payazaCheckoutUrl: payload.payazaCheckoutUrl,
  });
}
