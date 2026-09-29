import { DomainError } from "./errors.js";
import type { Currency } from "./money.js";

/** Payaza name enquiry is documented for NGN and GHS only. */
export const NAME_ENQUIRY_CURRENCIES = ["NGN", "GHS"] as const;

export type VerificationStatus = "UNVERIFIED" | "OTP_SENT" | "VERIFIED" | "LOCKED" | "COOLING_OFF";

export function nameEnquirySupported(currency: string): boolean {
  return (NAME_ENQUIRY_CURRENCIES as readonly string[]).includes(currency);
}

export interface PayoutMethodState {
  id: string;
  currency: Currency;
  phone: string;
  status: VerificationStatus;
  lockedTradeId: string | null;
  coolingOffUntil: Date | null;
  verifiedAt: Date | null;
}

export function assertCanPayout(method: PayoutMethodState, now: Date): void {
  if (method.status !== "VERIFIED" && method.status !== "LOCKED") {
    throw new DomainError("RECIPIENT_NOT_VERIFIED", "Payout number is not verified", 409, {
      status: method.status,
    });
  }
  if (method.coolingOffUntil && now < method.coolingOffUntil) {
    throw new DomainError("RECIPIENT_NOT_VERIFIED", "Payout number is in a cooling-off period", 409, {
      status: "COOLING_OFF",
      until: method.coolingOffUntil.toISOString(),
    });
  }
}

export function nextStatusAfterOtpSend(current: VerificationStatus): VerificationStatus {
  if (current === "LOCKED") {
    throw new DomainError("CONFLICT", "Locked payout number cannot be re-verified in place", 409);
  }
  return "OTP_SENT";
}

export function nextStatusAfterOtpVerify(current: VerificationStatus): VerificationStatus {
  if (current !== "OTP_SENT") {
    throw new DomainError("CONFLICT", "No OTP is outstanding", 409);
  }
  return "VERIFIED";
}

export function lockPayoutMethod(method: PayoutMethodState, tradeId: string): PayoutMethodState {
  if (method.status !== "VERIFIED" && method.status !== "LOCKED") {
    throw new DomainError("RECIPIENT_NOT_VERIFIED", "Cannot lock an unverified payout number", 409);
  }
  if (method.lockedTradeId && method.lockedTradeId !== tradeId) {
    throw new DomainError("CONFLICT", "Payout number is locked to another trade", 409);
  }
  return { ...method, status: "LOCKED", lockedTradeId: tradeId };
}

export function changePayoutNumber(input: {
  method: PayoutMethodState;
  now: Date;
  coolingSeconds: number;
}): PayoutMethodState {
  if (input.method.lockedTradeId) {
    throw new DomainError("CONFLICT", "Payout number is locked to an open trade", 409);
  }
  return {
    ...input.method,
    status: "COOLING_OFF",
    verifiedAt: null,
    coolingOffUntil: new Date(input.now.getTime() + input.coolingSeconds * 1000),
  };
}
