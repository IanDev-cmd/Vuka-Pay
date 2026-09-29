export function paymentQrText(input: {
  invoiceId: string;
  tradeId: string;
  payToken: string;
  corridor: string;
  settlementCurrency: string;
  amount: string;
  payazaCheckoutUrl: string | null;
}): string {
  return JSON.stringify({
    v: 1,
    invoiceId: input.invoiceId,
    tradeId: input.tradeId,
    payToken: input.payToken,
    corridor: input.corridor,
    settlementCurrency: input.settlementCurrency,
    amount: input.amount,
    payazaCheckoutUrl: input.payazaCheckoutUrl,
  });
}
