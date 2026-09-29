import type { CurrencyCode, Money } from "./types";

const EXPONENTS: Record<CurrencyCode, number> = { KES: 2, UGX: 0, TZS: 0 };

export function formatMoney(money: Money, withCode = false): string {
  const amount = formatMinor(money.amount_minor, money.currency);
  return withCode ? `${money.currency} ${amount}` : amount;
}

/** Whole units for UGX and TZS. KES hides a zero fraction. */
export function formatMinor(amountMinor: string, currency: CurrencyCode): string {
  if (!/^-?\d+$/.test(amountMinor)) return amountMinor;
  const negative = amountMinor.startsWith("-");
  const digits = negative ? amountMinor.slice(1) : amountMinor;
  const exponent = EXPONENTS[currency];
  const wholeDigits = exponent === 0 ? digits : digits.slice(0, Math.max(0, digits.length - exponent)) || "0";
  const fraction = exponent === 0 ? "" : digits.slice(-exponent).padStart(exponent, "0");
  const whole = wholeDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = fraction && !/^0+$/.test(fraction) ? `${whole}.${fraction}` : whole;
  return negative ? `-${body}` : body;
}

export function majorToMinor(major: string, currency: CurrencyCode): string | null {
  const cleaned = major.replace(/,/g, "").trim();
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const exponent = EXPONENTS[currency];
  const [whole, fraction = ""] = cleaned.split(".");
  if (exponent === 0 && fraction.length > 0) return null;
  if (fraction.length > exponent) return null;
  const padded = fraction.padEnd(exponent, "0");
  const minor = `${whole}${padded}`.replace(/^0+(?=\d)/, "");
  return minor.length > 0 ? minor : "0";
}

export function formatRate(rate: string): string {
  if (!/^\d+(\.\d+)?$/.test(rate)) return rate;
  const [whole, fraction = ""] = rate.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  if (trimmed.length === 0) return `${Number(whole).toLocaleString("en-US")}.00`;
  if (trimmed.length <= 2) return `${Number(whole).toLocaleString("en-US")}.${trimmed.padEnd(2, "0")}`;
  return `${Number(whole).toLocaleString("en-US")}.${trimmed}`;
}

export function countdownLabel(expiresAt: string, now: number): { text: string; expired: boolean } {
  const ms = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return { text: "00:00", expired: true };
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return { text: `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`, expired: false };
}

export function heldUntilClock(expiresAt: string): string {
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Africa/Nairobi",
  });
}

export function normalizePhoneDigits(input: string, currency: "UGX" | "TZS"): string {
  const prefix = currency === "UGX" ? "256" : "255";
  let digits = input.replace(/\D/g, "");
  if (digits.startsWith(prefix)) digits = digits.slice(prefix.length);
  digits = digits.replace(/^0+/, "");
  return `${prefix}${digits}`;
}
