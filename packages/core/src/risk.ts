import { DomainError } from "./errors.js";

export interface RiskConfig {
  maxInvoiceKesMinor: bigint;
  firstPayoutKesMinor: bigint;
  maxPayoutsPerDay: number;
  kycTier: "NONE" | "BASIC" | "BUSINESS" | "HIGHER";
}

export interface RiskSnapshot {
  priorPayoutCount: number;
  payoutsToday: number;
  openInvoiceKesMinor: bigint;
}

const TIER_MULTIPLIER: Record<RiskConfig["kycTier"], number> = {
  NONE: 0,
  BASIC: 1,
  BUSINESS: 3,
  HIGHER: 10,
};

export function assertInvoiceAllowed(amountMinor: bigint, config: RiskConfig, snapshot: RiskSnapshot): void {
  if (config.kycTier === "NONE") {
    throw new DomainError("KYC_REQUIRED", "A verified KYC tier is required before invoicing", 403);
  }
  const cap = (config.maxInvoiceKesMinor * BigInt(TIER_MULTIPLIER[config.kycTier])) / 1n;
  if (amountMinor > cap) {
    throw new DomainError("LIMIT_EXCEEDED", "Invoice exceeds the VukaPay limit for this KYC tier", 409, {
      limit_minor: cap.toString(),
    });
  }
  if (snapshot.openInvoiceKesMinor + amountMinor > cap * 5n) {
    throw new DomainError("LIMIT_EXCEEDED", "Open invoice exposure exceeds the tier velocity limit", 409);
  }
}

export function assertPayoutAllowed(amountMinor: bigint, config: RiskConfig, snapshot: RiskSnapshot): void {
  if (snapshot.payoutsToday >= config.maxPayoutsPerDay) {
    throw new DomainError("LIMIT_EXCEEDED", "Daily payout count reached", 409);
  }
  if (snapshot.priorPayoutCount === 0 && amountMinor > config.firstPayoutKesMinor) {
    throw new DomainError("LIMIT_EXCEEDED", "First payout exceeds the new-recipient cap", 409, {
      limit_minor: config.firstPayoutKesMinor.toString(),
    });
  }
}

export function duplicateInvoice(input: {
  existingFingerprints: string[];
  fingerprint: string;
}): void {
  if (input.existingFingerprints.includes(input.fingerprint)) {
    throw new DomainError("CONFLICT", "An open invoice with the same buyer, amount, and day already exists", 409);
  }
}
