import { DomainError } from "./errors.js";
import { payloadHash } from "./ids.js";

export const TRADE_STATES = [
  "DRAFT",
  "INVOICED",
  "AWAITING_PAYMENT",
  "PAYMENT_PENDING",
  "PARTIALLY_FUNDED",
  "FUNDED",
  "SHIPPED",
  "DELIVERY_CLAIMED",
  "DISPUTED",
  "RELEASE_PENDING",
  "PAYOUT_FAILED",
  "REFUND_PENDING",
  "SPLIT_PENDING",
  "PAID_OUT",
  "REFUNDED",
  "CANCELLED",
  "EXPIRED",
  "PAYMENT_FAILED",
] as const;

export type TradeState = (typeof TRADE_STATES)[number];

export const TERMINAL_STATES = new Set<TradeState>([
  "PAID_OUT",
  "REFUNDED",
  "CANCELLED",
  "EXPIRED",
  "PAYMENT_FAILED",
]);

/**
 * §5.1 table, plus the retry edges required by POST /pay/:token/retry:
 * PAYMENT_FAILED and prompt-expiry EXPIRED may return to PAYMENT_PENDING when a new
 * Payaza reference is minted and the invoice hard deadline has not passed.
 * Refund/split payout failures return to their own pending state, never to exporter release.
 */
export const TRANSITIONS: Record<TradeState, readonly TradeState[]> = {
  DRAFT: ["INVOICED", "CANCELLED"],
  INVOICED: ["AWAITING_PAYMENT", "EXPIRED", "CANCELLED"],
  AWAITING_PAYMENT: ["PAYMENT_PENDING", "EXPIRED"],
  PAYMENT_PENDING: ["FUNDED", "PAYMENT_FAILED", "PARTIALLY_FUNDED", "EXPIRED"],
  PARTIALLY_FUNDED: ["FUNDED", "REFUND_PENDING"],
  FUNDED: ["SHIPPED", "REFUND_PENDING", "DISPUTED"],
  SHIPPED: ["DELIVERY_CLAIMED", "DISPUTED", "RELEASE_PENDING"],
  DELIVERY_CLAIMED: ["RELEASE_PENDING", "DISPUTED"],
  DISPUTED: ["RELEASE_PENDING", "REFUND_PENDING", "SPLIT_PENDING"],
  RELEASE_PENDING: ["PAID_OUT", "PAYOUT_FAILED"],
  PAYOUT_FAILED: ["RELEASE_PENDING", "REFUND_PENDING", "SPLIT_PENDING"],
  REFUND_PENDING: ["REFUNDED", "PAYOUT_FAILED"],
  SPLIT_PENDING: ["PAID_OUT", "PAYOUT_FAILED"],
  PAID_OUT: [],
  REFUNDED: [],
  CANCELLED: [],
  EXPIRED: ["PAYMENT_PENDING"],
  PAYMENT_FAILED: ["PAYMENT_PENDING"],
};

export type TradeCommand =
  | "ISSUE"
  | "CANCEL"
  | "BUYER_OPENED"
  | "PROMPT_SENT"
  | "PAYMENT_EXACT"
  | "PAYMENT_UNDER"
  | "PAYMENT_OVER"
  | "TOP_UP"
  | "PAYMENT_FAILED"
  | "EXPIRE"
  | "RETRY"
  | "SHIP"
  | "DELIVERY_CLAIMED"
  | "CONFIRM_DELIVERY"
  | "NFC_VERIFY"
  | "AUTO_RELEASE"
  | "DISPUTE"
  | "RESOLVE_RELEASE"
  | "RESOLVE_REFUND"
  | "RESOLVE_SPLIT"
  | "PAYOUT_SUBMITTED"
  | "PAYOUT_SUCCEEDED"
  | "PAYOUT_FAILED"
  | "REFUND_SUCCEEDED"
  | "RETRY_PAYOUT";

export type Effect =
  | "LOCK_FUNDS"
  | "LOCK_INVOICE_AND_QUEUE_EXCESS_REFUND"
  | "RECORD_PARTIAL"
  | "NOTIFY_SHIP"
  | "START_DISPUTE_WINDOW"
  | "CREATE_RELEASE_PAYOUT"
  | "CREATE_REFUND_PAYOUT"
  | "CREATE_SPLIT_PAYOUTS"
  | "WRITE_TRADE_RECORD"
  | "FREEZE_FUNDS";

export type PayoutIntent = "RELEASE" | "REFUND" | "SPLIT" | null;

export interface TransitionInput {
  command: TradeCommand;
  actor: string;
  reason: string;
  payload?: unknown;
  now: Date;
  quoteExpiresAt?: Date | null;
  invoiceDeadline?: Date | null;
  disputeWindowEndsAt?: Date | null;
  payoutIntent?: PayoutIntent;
  payazaConfirmedFailure?: boolean;
  codeMatches?: boolean;
  nfcOk?: boolean;
  attemptCount?: number;
  maxAttempts?: number;
}

export interface TradeEventDraft {
  fromState: TradeState;
  toState: TradeState;
  command: TradeCommand;
  actor: string;
  reason: string;
  payloadHash: string;
  at: string;
  effects: Effect[];
}

export function isTerminal(state: TradeState): boolean {
  return TERMINAL_STATES.has(state) && TRANSITIONS[state].length === 0;
}

export function transition(from: TradeState, input: TransitionInput): TradeEventDraft {
  const to = resolveTarget(from, input);
  const allowed = TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new DomainError(
      "ILLEGAL_STATE_TRANSITION",
      `Cannot move from ${from} to ${to} via ${input.command}`,
      409,
      { from, to, command: input.command },
    );
  }
  enforceGuards(from, to, input);
  return {
    fromState: from,
    toState: to,
    command: input.command,
    actor: input.actor,
    reason: input.reason,
    payloadHash: payloadHash(input.payload ?? {}),
    at: input.now.toISOString(),
    effects: effectsFor(from, to, input.command),
  };
}

function resolveTarget(from: TradeState, input: TransitionInput): TradeState {
  switch (input.command) {
    case "ISSUE":
      return "INVOICED";
    case "CANCEL":
      return "CANCELLED";
    case "BUYER_OPENED":
      return "AWAITING_PAYMENT";
    case "PROMPT_SENT":
      return "PAYMENT_PENDING";
    case "PAYMENT_EXACT":
    case "PAYMENT_OVER":
      return "FUNDED";
    case "PAYMENT_UNDER":
      return "PARTIALLY_FUNDED";
    case "TOP_UP":
      return "FUNDED";
    case "PAYMENT_FAILED":
      return "PAYMENT_FAILED";
    case "EXPIRE":
      return "EXPIRED";
    case "RETRY":
      return "PAYMENT_PENDING";
    case "SHIP":
      return "SHIPPED";
    case "DELIVERY_CLAIMED":
      return "DELIVERY_CLAIMED";
    case "CONFIRM_DELIVERY":
    case "NFC_VERIFY":
    case "AUTO_RELEASE":
    case "RESOLVE_RELEASE":
      return "RELEASE_PENDING";
    case "DISPUTE":
      return "DISPUTED";
    case "RESOLVE_REFUND":
      return "REFUND_PENDING";
    case "RESOLVE_SPLIT":
      return "SPLIT_PENDING";
    case "PAYOUT_SUBMITTED":
      return from;
    case "PAYOUT_SUCCEEDED":
      return from === "REFUND_PENDING" ? "REFUNDED" : "PAID_OUT";
    case "PAYOUT_FAILED":
      return "PAYOUT_FAILED";
    case "REFUND_SUCCEEDED":
      return "REFUNDED";
    case "RETRY_PAYOUT": {
      const intent = input.payoutIntent ?? "RELEASE";
      if (intent === "REFUND") return "REFUND_PENDING";
      if (intent === "SPLIT") return "SPLIT_PENDING";
      return "RELEASE_PENDING";
    }
    default:
      return from;
  }
}

function enforceGuards(from: TradeState, to: TradeState, input: TransitionInput): void {
  if (input.command === "PAYOUT_SUBMITTED") {
    throw new DomainError(
      "ILLEGAL_STATE_TRANSITION",
      "Payout submission is recorded on the payout row and does not change trade state",
      409,
    );
  }
  if ((input.command === "RETRY" || (to === "PAYMENT_PENDING" && from === "EXPIRED")) && input.command === "RETRY") {
    const max = input.maxAttempts ?? 3;
    if ((input.attemptCount ?? 0) >= max) {
      throw new DomainError("LIMIT_EXCEEDED", "Collection retry limit reached", 409);
    }
    if (input.invoiceDeadline && input.now > input.invoiceDeadline) {
      throw new DomainError("QUOTE_EXPIRED", "Invoice deadline has passed", 409);
    }
  }
  if (from === "EXPIRED" && input.command !== "RETRY") {
    throw new DomainError("ILLEGAL_STATE_TRANSITION", "Expired trades can only be retried", 409);
  }
  if (from === "PAYMENT_FAILED" && input.command !== "RETRY") {
    throw new DomainError("ILLEGAL_STATE_TRANSITION", "Failed payments can only be retried", 409);
  }
  if (input.command === "CONFIRM_DELIVERY" && input.codeMatches !== true) {
    throw new DomainError("VALIDATION_FAILED", "Delivery code does not match", 422);
  }
  if (input.command === "NFC_VERIFY" && input.nfcOk !== true) {
    throw new DomainError("VALIDATION_FAILED", "NFC token did not authenticate", 422);
  }
  if (input.command === "AUTO_RELEASE") {
    if (!input.disputeWindowEndsAt || input.now < input.disputeWindowEndsAt) {
      throw new DomainError("ILLEGAL_STATE_TRANSITION", "Dispute window has not elapsed", 409);
    }
  }
  if (input.command === "PAYOUT_FAILED" && to === "PAYOUT_FAILED") {
    return;
  }
  if (from === "PAYOUT_FAILED") {
    if (input.payazaConfirmedFailure !== true) {
      throw new DomainError(
        "ILLEGAL_STATE_TRANSITION",
        "A new payout reference is allowed only after Payaza confirms NIP_FAILURE or a reversal",
        409,
      );
    }
    const intent = input.payoutIntent ?? "RELEASE";
    const expected =
      intent === "REFUND" ? "REFUND_PENDING" : intent === "SPLIT" ? "SPLIT_PENDING" : "RELEASE_PENDING";
    if (to !== expected) {
      throw new DomainError(
        "ILLEGAL_STATE_TRANSITION",
        `Payout failure intent ${intent} must return to ${expected}`,
        409,
      );
    }
  }
  if (to === "EXPIRED" && (from === "FUNDED" || from === "SHIPPED" || from === "DELIVERY_CLAIMED")) {
    throw new DomainError("ILLEGAL_STATE_TRANSITION", "Funded trades do not expire", 409);
  }
}

function effectsFor(from: TradeState, to: TradeState, command: TradeCommand): Effect[] {
  if (to === "FUNDED" && (from === "PAYMENT_PENDING" || from === "PARTIALLY_FUNDED")) {
    return command === "PAYMENT_OVER"
      ? ["LOCK_INVOICE_AND_QUEUE_EXCESS_REFUND", "NOTIFY_SHIP"]
      : ["LOCK_FUNDS", "NOTIFY_SHIP"];
  }
  if (to === "PARTIALLY_FUNDED") return ["RECORD_PARTIAL"];
  if (to === "DISPUTED") return ["FREEZE_FUNDS"];
  if (to === "DELIVERY_CLAIMED") return ["START_DISPUTE_WINDOW"];
  if (to === "RELEASE_PENDING") return ["CREATE_RELEASE_PAYOUT"];
  if (to === "REFUND_PENDING") return ["CREATE_REFUND_PAYOUT"];
  if (to === "SPLIT_PENDING") return ["CREATE_SPLIT_PAYOUTS"];
  if (to === "PAID_OUT" || to === "REFUNDED" || to === "CANCELLED" || to === "EXPIRED" || to === "PAYMENT_FAILED") {
    return ["WRITE_TRADE_RECORD"];
  }
  return [];
}
