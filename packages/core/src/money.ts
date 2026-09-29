export const CURRENCIES = ["KES", "UGX", "TZS", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];

/** ISO-style minor-unit exponents. TZS is 0 per product spec (mobile-money whole units), not ISO 4217's 2. */
export const EXPONENTS: Record<Currency, number> = {
  KES: 2,
  UGX: 0,
  TZS: 0,
  USD: 2,
};

export const CURRENCY_META: Record<Currency, { symbol: string; name: string }> = {
  KES: { symbol: "KSh", name: "Kenyan shilling" },
  UGX: { symbol: "USh", name: "Ugandan shilling" },
  TZS: { symbol: "TSh", name: "Tanzanian shilling" },
  USD: { symbol: "$", name: "US dollar" },
};

export interface Money {
  amountMinor: bigint;
  currency: Currency;
}

export function isCurrency(value: string): value is Currency {
  return (CURRENCIES as readonly string[]).includes(value);
}

export function assertCurrency(value: string): Currency {
  if (!isCurrency(value)) {
    throw new Error(`Unsupported currency ${value}`);
  }
  return value;
}

export function exponentOf(currency: Currency): number {
  return EXPONENTS[currency];
}

export function parseMinor(value: string | bigint): bigint {
  if (typeof value === "bigint") return value;
  if (!/^-?\d+$/.test(value)) {
    throw new Error("amount_minor must be an integer string");
  }
  return BigInt(value);
}

export function money(amountMinor: bigint | string, currency: Currency): Money {
  return { amountMinor: parseMinor(amountMinor), currency };
}

export function formatMinor(amountMinor: bigint): string {
  return amountMinor.toString();
}

/**
 * Payaza request bodies use major-unit JSON numbers.
 * Convert only when the value round-trips exactly through IEEE-754.
 */
export function minorToPayazaNumber(amountMinor: bigint, currency: Currency): number {
  const exponent = exponentOf(currency);
  const negative = amountMinor < 0n;
  const abs = negative ? -amountMinor : amountMinor;
  const factor = 10n ** BigInt(exponent);
  const whole = abs / factor;
  const fraction = abs % factor;
  const text =
    exponent === 0 ? whole.toString() : `${whole.toString()}.${fraction.toString().padStart(exponent, "0")}`;
  const numeric = Number(text);
  if (!Number.isSafeInteger(Number(whole)) || !Number.isFinite(numeric)) {
    throw new Error("Amount cannot be represented exactly for Payaza");
  }
  if (payazaNumberToMinor(numeric, currency) !== amountMinor) {
    throw new Error("Amount cannot be represented exactly for Payaza");
  }
  return negative ? -numeric : numeric;
}

export function payazaNumberToMinor(value: number | string, currency: Currency): bigint {
  const text = typeof value === "number" ? value.toString() : value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) {
    throw new Error(`Payaza amount is not a decimal: ${text}`);
  }
  const negative = text.startsWith("-");
  const unsigned = negative ? text.slice(1) : text;
  const [whole, fraction = ""] = unsigned.split(".");
  const exponent = exponentOf(currency);
  if (fraction.length > exponent) {
    throw new Error(`Payaza amount has more decimals than ${currency} exponent ${exponent}`);
  }
  const padded = fraction.padEnd(exponent, "0");
  const minor = BigInt(whole + padded);
  return negative ? -minor : minor;
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) throw new Error("currency mismatch");
  return { amountMinor: a.amountMinor + b.amountMinor, currency: a.currency };
}
