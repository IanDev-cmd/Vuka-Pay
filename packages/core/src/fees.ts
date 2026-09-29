export interface FeeConfig {
  bps: number;
  minMinor: bigint;
  maxMinor: bigint;
}

/**
 * One allocation rule for every screen.
 * The VukaPay fee is deducted from the exporter's KES goods amount.
 * It is not added on top of the invoice. Payaza's transaction_fee is not estimated.
 */
export const FEE_ALLOCATION = "deducted_from_exporter" as const;

export interface FeeBreakdown {
  itemsMinor: bigint;
  vukapayFeeMinor: bigint;
  exporterNetMinor: bigint;
  /** Payaza's transaction_fee is recorded from the webhook. It is not estimated here. */
  payazaFee: "recorded_on_settlement";
}

export function vukapayFee(itemsMinor: bigint, config: FeeConfig): bigint {
  if (itemsMinor < 0n) throw new Error("items cannot be negative");
  if (config.bps < 0) throw new Error("fee bps cannot be negative");
  const raw = (itemsMinor * BigInt(config.bps) + 5_000n) / 10_000n;
  let fee = raw;
  if (config.minMinor > 0n && fee < config.minMinor) fee = config.minMinor;
  if (config.maxMinor > 0n && fee > config.maxMinor) fee = config.maxMinor;
  if (fee > itemsMinor) fee = itemsMinor;
  return fee;
}

export function feeBreakdown(itemsMinor: bigint, config: FeeConfig): FeeBreakdown {
  const vukapayFeeMinor = vukapayFee(itemsMinor, config);
  return {
    itemsMinor,
    vukapayFeeMinor,
    exporterNetMinor: itemsMinor - vukapayFeeMinor,
    payazaFee: "recorded_on_settlement",
  };
}
