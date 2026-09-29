import { DomainError } from "./errors.js";
import type { TradeCommand } from "./escrow.js";

export type AmountValidation = "EXACT" | "UNDERPAYMENT" | "OVERPAYMENT";

export interface CollectionDecision {
  command: Extract<TradeCommand, "PAYMENT_EXACT" | "PAYMENT_UNDER" | "PAYMENT_OVER" | "TOP_UP">;
  holdMinor: bigint;
  refundMinor: bigint;
  newlyHeldMinor: bigint;
}

/**
 * Fail closed when the webhook label is missing or disagrees with the amounts.
 * Cumulative held funds are compared to the locked quote in buyer minor units.
 */
export function decideCollection(input: {
  validation: string | undefined;
  amountReceivedMinor: bigint;
  quotedMinor: bigint;
  alreadyHeldMinor: bigint;
}): CollectionDecision {
  if (input.validation !== "EXACT" && input.validation !== "UNDERPAYMENT" && input.validation !== "OVERPAYMENT") {
    throw new DomainError(
      "VALIDATION_FAILED",
      "Collection webhook is missing a known amount_validation value",
      422,
      { amount_validation: input.validation ?? null },
    );
  }
  if (input.amountReceivedMinor <= 0n) {
    throw new DomainError("VALIDATION_FAILED", "amount_received must be positive", 422);
  }
  const cumulative = input.alreadyHeldMinor + input.amountReceivedMinor;

  if (input.validation === "EXACT") {
    if (input.amountReceivedMinor !== input.quotedMinor || input.alreadyHeldMinor !== 0n) {
      throw new DomainError("VALIDATION_FAILED", "EXACT validation does not match the locked quote", 422);
    }
    return {
      command: "PAYMENT_EXACT",
      holdMinor: input.amountReceivedMinor,
      refundMinor: 0n,
      newlyHeldMinor: input.amountReceivedMinor,
    };
  }

  if (input.validation === "UNDERPAYMENT") {
    if (input.amountReceivedMinor >= input.quotedMinor) {
      throw new DomainError("VALIDATION_FAILED", "UNDERPAYMENT amount is not below the quote", 422);
    }
    if (cumulative < input.quotedMinor) {
      return {
        command: "PAYMENT_UNDER",
        holdMinor: input.amountReceivedMinor,
        refundMinor: 0n,
        newlyHeldMinor: input.amountReceivedMinor,
      };
    }
    if (cumulative === input.quotedMinor) {
      return {
        command: "TOP_UP",
        holdMinor: input.amountReceivedMinor,
        refundMinor: 0n,
        newlyHeldMinor: input.amountReceivedMinor,
      };
    }
    throw new DomainError("VALIDATION_FAILED", "Top-up exceeds the locked quote", 422);
  }

  if (input.alreadyHeldMinor !== 0n || input.amountReceivedMinor <= input.quotedMinor) {
    throw new DomainError("VALIDATION_FAILED", "OVERPAYMENT does not match the amounts", 422);
  }
  return {
    command: "PAYMENT_OVER",
    holdMinor: input.quotedMinor,
    refundMinor: input.amountReceivedMinor - input.quotedMinor,
    newlyHeldMinor: input.quotedMinor,
  };
}
