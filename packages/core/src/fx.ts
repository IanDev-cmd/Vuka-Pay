import { DomainError } from "./errors.js";
import {
  applyRate,
  applySpreadBps,
  deviationBps,
  formatDecimal,
  parseDecimal,
  quotePerKes,
} from "./decimal.js";
import { feeBreakdown, type FeeConfig } from "./fees.js";
import type { Currency } from "./money.js";

export interface RateObservation {
  source: string;
  /** Buyer-currency major units per 1 KES major unit. */
  rate: string;
  asOf: Date;
}

export interface UsdLeg {
  source: string;
  kesPerUsd: string;
  quotePerUsd: string;
  asOf: Date;
}

export interface FxQuote {
  from: "KES";
  to: Currency;
  midRate: string;
  spreadBps: number;
  feeMinor: bigint;
  itemsMinor: bigint;
  buyerAmountMinor: bigint;
  exporterNetKesMinor: bigint;
  expiresAt: Date;
  sources: string[];
  fxClearingDust: string;
}

export interface QuoteConfig {
  spreadBps: number;
  ttlSeconds: number;
  maxDeviationBps: number;
  maxRateAgeSeconds: number;
  fee: FeeConfig;
}

export function observationsFromUsdLegs(legs: UsdLeg[], quote: Currency): RateObservation[] {
  return legs.map((leg) => ({
    source: leg.source,
    asOf: leg.asOf,
    rate: quotePerKes(leg.kesPerUsd, leg.quotePerUsd),
  }));
}

export function issueQuote(input: {
  itemsMinor: bigint;
  to: Extract<Currency, "UGX" | "TZS" | "RWF">;
  observations: RateObservation[];
  config: QuoteConfig;
  now: Date;
}): FxQuote {
  if (input.itemsMinor <= 0n) {
    throw new DomainError("VALIDATION_FAILED", "Invoice total must be positive", 422);
  }
  const fresh = input.observations.filter((row) => {
    const age = (input.now.getTime() - row.asOf.getTime()) / 1000;
    return age >= 0 && age <= input.config.maxRateAgeSeconds;
  });
  if (fresh.length < 2) {
    throw new DomainError(
      "FX_RATE_UNAVAILABLE",
      "At least two fresh rate sources are required",
      503,
      { fresh: fresh.length, observed: input.observations.length },
    );
  }
  const parsed = fresh.map((row) => ({ ...row, decimal: parseDecimal(row.rate) }));
  const rates = parsed.map((row) => row.decimal);
  const worst = pairwiseDeviation(rates);
  if (worst > input.config.maxDeviationBps) {
    throw new DomainError(
      "FX_RATE_UNAVAILABLE",
      "Rate sources deviate beyond the configured threshold",
      503,
      { deviation_bps: worst, max_bps: input.config.maxDeviationBps },
    );
  }
  const mid = medianDecimal(rates);
  const withSpread = applySpreadBps(mid, input.config.spreadBps);
  const applied = applyRate({
    amountMinor: input.itemsMinor,
    amountExponent: 2,
    rate: withSpread,
    outExponent: input.to === "UGX" || input.to === "TZS" || input.to === "RWF" ? 0 : 2,
  });
  if (applied.amountMinor <= 0n) {
    throw new DomainError("FX_RATE_UNAVAILABLE", "Quoted buyer amount rounded to zero", 503);
  }
  const fees = feeBreakdown(input.itemsMinor, input.config.fee);
  return {
    from: "KES",
    to: input.to,
    midRate: formatDecimal(mid),
    spreadBps: input.config.spreadBps,
    feeMinor: fees.vukapayFeeMinor,
    itemsMinor: input.itemsMinor,
    buyerAmountMinor: applied.amountMinor,
    exporterNetKesMinor: fees.exporterNetMinor,
    expiresAt: new Date(input.now.getTime() + input.config.ttlSeconds * 1000),
    sources: parsed.map((row) => row.source).sort(),
    fxClearingDust: `${applied.dustNumerator.toString()}/${applied.dustDenominator.toString()}`,
  };
}

/** Same-currency Kenya collection. The buyer pays the KES goods amount. No FX source is required. */
export function issueKesQuote(input: { itemsMinor: bigint; config: QuoteConfig; now: Date }): FxQuote {
  if (input.itemsMinor <= 0n) {
    throw new DomainError("VALIDATION_FAILED", "Invoice total must be positive", 422);
  }
  const fees = feeBreakdown(input.itemsMinor, input.config.fee);
  return {
    from: "KES",
    to: "KES",
    midRate: "1",
    spreadBps: 0,
    feeMinor: fees.vukapayFeeMinor,
    itemsMinor: input.itemsMinor,
    buyerAmountMinor: input.itemsMinor,
    exporterNetKesMinor: fees.exporterNetMinor,
    expiresAt: new Date(input.now.getTime() + input.config.ttlSeconds * 1000),
    sources: ["kes-identity"],
    fxClearingDust: "0/1",
  };
}

export function assertQuoteLive(expiresAt: Date, now: Date): void {
  if (now.getTime() >= expiresAt.getTime()) {
    throw new DomainError("QUOTE_EXPIRED", "The locked quote has expired", 409);
  }
}

function pairwiseDeviation(rates: { value: bigint; scale: number }[]): number {
  let worst = 0;
  for (let i = 0; i < rates.length; i++) {
    for (let j = i + 1; j < rates.length; j++) {
      const left = rates[i];
      const right = rates[j];
      if (!left || !right) continue;
      worst = Math.max(worst, deviationBps(left, right));
    }
  }
  return worst;
}

function medianDecimal(rates: { value: bigint; scale: number }[]): { value: bigint; scale: number } {
  const scale = Math.max(...rates.map((rate) => rate.scale));
  const scaled = rates
    .map((rate) => rate.value * 10n ** BigInt(scale - rate.scale))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const mid = scaled.length >> 1;
  const value =
    scaled.length % 2 === 1 ? scaled[mid]! : (scaled[mid - 1]! + scaled[mid]!) / 2n;
  return { value, scale };
}

export type SettlementMode = "none" | "treasury_float";

export interface ConversionInput {
  sellCurrency: Currency;
  sellMinor: bigint;
  buyCurrency: Currency;
  buyMinor: bigint;
  evidenceRef: string;
  counterparty: string;
}

export function assertSettlementAvailable(mode: SettlementMode): void {
  if (mode !== "treasury_float") {
    throw new DomainError(
      "FX_SETTLEMENT_UNAVAILABLE",
      "No confirmed FX settlement mechanism is enabled",
      409,
    );
  }
}

export function assertExposureAllows(input: {
  openExposureMinor: bigint;
  additionalMinor: bigint;
  maxOpenExposureMinor: bigint;
}): void {
  if (input.maxOpenExposureMinor <= 0n) {
    throw new DomainError(
      "FX_SETTLEMENT_UNAVAILABLE",
      "Treasury float exposure limit is not configured",
      409,
    );
  }
  if (input.openExposureMinor + input.additionalMinor > input.maxOpenExposureMinor) {
    throw new DomainError("LIMIT_EXCEEDED", "Open FX exposure limit reached", 409, {
      open_exposure_minor: input.openExposureMinor.toString(),
      max_minor: input.maxOpenExposureMinor.toString(),
    });
  }
}

export function assertTreasuryEvidence(input: ConversionInput): void {
  if (!input.evidenceRef.trim() || !input.counterparty.trim()) {
    throw new DomainError(
      "VALIDATION_FAILED",
      "A treasury conversion requires a counterparty and an evidence reference",
      422,
    );
  }
  if (input.sellMinor <= 0n || input.buyMinor <= 0n) {
    throw new DomainError("VALIDATION_FAILED", "Conversion amounts must be positive", 422);
  }
}
