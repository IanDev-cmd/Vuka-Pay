import { DomainError } from "./errors.js";

export interface PhoneRule {
  prefix: string;
  digits: number;
}

export const PHONE_RULES = {
  KE: { prefix: "254", digits: 12 },
  UG: { prefix: "256", digits: 12 },
  TZ: { prefix: "255", digits: 12 },
} as const satisfies Record<string, PhoneRule>;

export type PhoneCountry = keyof typeof PHONE_RULES;

/**
 * International format, no + or spaces.
 * KES/UGX/TZS collections are 12 digits including the country prefix (Payaza momo guide).
 */
export function normalizePhone(input: string, country: PhoneCountry): string {
  const rule = PHONE_RULES[country];
  const digits = input.replace(/\D/g, "");
  let national = digits;
  if (national.startsWith(rule.prefix)) {
    national = national.slice(rule.prefix.length);
  }
  national = national.replace(/^0+/, "");
  const full = `${rule.prefix}${national}`;
  if (full.length !== rule.digits) {
    throw new DomainError(
      "INVALID_PHONE_FORMAT",
      `Phone number for ${country} must be ${rule.digits} digits in international format (${rule.prefix}…)`,
      422,
      { country, expected_digits: rule.digits, prefix: rule.prefix },
    );
  }
  return full;
}

/** Payaza payout narration: 25 characters or fewer, no special characters. */
export function payoutNarration(input: string): string {
  const cleaned = input.replace(/[^A-Za-z0-9 ]/g, " ").replace(/\s+/g, " ").trim().slice(0, 25);
  return cleaned.length > 0 ? cleaned : "VukaPay";
}
