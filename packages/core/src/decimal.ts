/** Non-negative decimal arithmetic on integers. Rates never pass through binary floats. */

export interface Decimal {
  /** value / 10^scale */
  value: bigint;
  scale: number;
}

export function parseDecimal(input: string): Decimal {
  const text = input.trim();
  if (!/^\d+(\.\d+)?$/.test(text)) {
    throw new Error(`Invalid decimal: ${input}`);
  }
  const [whole, fraction = ""] = text.split(".");
  return { value: BigInt((whole ?? "0") + fraction), scale: fraction.length };
}

export function formatDecimal(decimal: Decimal): string {
  const raw = decimal.value.toString().padStart(decimal.scale + 1, "0");
  if (decimal.scale === 0) return raw;
  const cut = raw.length - decimal.scale;
  const whole = raw.slice(0, cut);
  const fraction = raw.slice(cut).replace(/0+$/, "");
  return fraction.length === 0 ? whole : `${whole}.${fraction}`;
}

export function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error("denominator must be positive");
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const quotient = (absolute + denominator / 2n) / denominator;
  return negative ? -quotient : quotient;
}

/** (a / b) rounded half-up to `scaleOut` decimal places. */
export function divideDecimal(numerator: Decimal, denominator: Decimal, scaleOut: number): Decimal {
  if (denominator.value === 0n) throw new Error("division by zero");
  const num = numerator.value * 10n ** BigInt(denominator.scale + scaleOut);
  const den = denominator.value * 10n ** BigInt(numerator.scale);
  return { value: divRoundHalfUp(num, den), scale: scaleOut };
}

/**
 * amountMinor (in `amountExponent`) * rate, rounded half-up to `outExponent`.
 * Rate is quote-currency major units per 1 base-currency major unit.
 */
export function applyRate(input: {
  amountMinor: bigint;
  amountExponent: number;
  rate: Decimal;
  outExponent: number;
}): { amountMinor: bigint; dustNumerator: bigint; dustDenominator: bigint } {
  const scale = input.amountExponent + input.rate.scale - input.outExponent;
  if (scale < 0) {
    const factor = 10n ** BigInt(-scale);
    return {
      amountMinor: input.amountMinor * input.rate.value * factor,
      dustNumerator: 0n,
      dustDenominator: 1n,
    };
  }
  const denominator = 10n ** BigInt(scale);
  const numerator = input.amountMinor * input.rate.value;
  const amountMinor = divRoundHalfUp(numerator, denominator);
  const dustNumerator = numerator - amountMinor * denominator;
  return { amountMinor, dustNumerator, dustDenominator: denominator };
}

/** UGX-per-KES = (UGX per USD) / (KES per USD). */
export function quotePerKes(usdToKes: string, usdToQuote: string, scaleOut = 8): string {
  const rate = divideDecimal(parseDecimal(usdToQuote), parseDecimal(usdToKes), scaleOut);
  return formatDecimal(rate);
}

export function applySpreadBps(rate: Decimal, spreadBps: number): Decimal {
  if (spreadBps < 0) throw new Error("spread cannot be negative");
  return {
    value: divRoundHalfUp(rate.value * BigInt(10_000 + spreadBps), 10_000n),
    scale: rate.scale,
  };
}

export function deviationBps(a: Decimal, b: Decimal): number {
  const scale = Math.max(a.scale, b.scale);
  const av = a.value * 10n ** BigInt(scale - a.scale);
  const bv = b.value * 10n ** BigInt(scale - b.scale);
  const diff = av > bv ? av - bv : bv - av;
  const mid = (av + bv) / 2n;
  if (mid === 0n) return 0;
  return Number((diff * 10_000n) / mid);
}
