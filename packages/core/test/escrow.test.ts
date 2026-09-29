import { describe, expect, it } from "vitest";
import { DomainError } from "../src/errors.js";
import { transition, TRANSITIONS, type TradeCommand, type TradeState } from "../src/escrow.js";

const now = new Date("2026-09-28T12:00:00.000Z");
const later = new Date("2026-09-28T18:00:00.000Z");

function go(from: TradeState, command: TradeCommand, extra: Record<string, unknown> = {}) {
  return transition(from, {
    command,
    actor: "test",
    reason: "unit",
    now,
    ...extra,
  });
}

describe("escrow transitions", () => {
  it("walks the happy path", () => {
    expect(go("DRAFT", "ISSUE").toState).toBe("INVOICED");
    expect(go("INVOICED", "BUYER_OPENED").toState).toBe("AWAITING_PAYMENT");
    expect(go("AWAITING_PAYMENT", "PROMPT_SENT").toState).toBe("PAYMENT_PENDING");
    const funded = go("PAYMENT_PENDING", "PAYMENT_EXACT");
    expect(funded.toState).toBe("FUNDED");
    expect(funded.effects).toContain("LOCK_FUNDS");
    expect(funded.effects).toContain("NOTIFY_SHIP");
    expect(go("FUNDED", "SHIP").toState).toBe("SHIPPED");
    expect(go("SHIPPED", "DELIVERY_CLAIMED").effects).toContain("START_DISPUTE_WINDOW");
    const release = go("DELIVERY_CLAIMED", "CONFIRM_DELIVERY", { codeMatches: true });
    expect(release.toState).toBe("RELEASE_PENDING");
    expect(release.effects).toContain("CREATE_RELEASE_PAYOUT");
    expect(go("RELEASE_PENDING", "PAYOUT_SUCCEEDED").toState).toBe("PAID_OUT");
  });

  it("rejects an illegal skip to paid", () => {
    expect(() => go("FUNDED", "PAYOUT_SUCCEEDED")).toThrow(DomainError);
    try {
      go("FUNDED", "PAYOUT_SUCCEEDED");
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe("ILLEGAL_STATE_TRANSITION");
    }
  });

  it("locks the invoice amount and queues excess on overpayment", () => {
    const event = go("PAYMENT_PENDING", "PAYMENT_OVER");
    expect(event.toState).toBe("FUNDED");
    expect(event.effects).toContain("LOCK_INVOICE_AND_QUEUE_EXCESS_REFUND");
  });

  it("keeps an underpayment partial until a top-up", () => {
    expect(go("PAYMENT_PENDING", "PAYMENT_UNDER").toState).toBe("PARTIALLY_FUNDED");
    expect(go("PARTIALLY_FUNDED", "TOP_UP").toState).toBe("FUNDED");
  });

  it("requires a matching delivery code and an elapsed dispute window", () => {
    expect(() => go("DELIVERY_CLAIMED", "CONFIRM_DELIVERY", { codeMatches: false })).toThrow(
      /Delivery code/,
    );
    expect(() =>
      go("DELIVERY_CLAIMED", "AUTO_RELEASE", { disputeWindowEndsAt: later }),
    ).toThrow(/Dispute window/);
    expect(
      go("DELIVERY_CLAIMED", "AUTO_RELEASE", {
        now: later,
        disputeWindowEndsAt: now,
      }).toState,
    ).toBe("RELEASE_PENDING");
  });

  it("retries a failed collection with a new attempt and blocks after the cap", () => {
    expect(go("PAYMENT_FAILED", "RETRY", { attemptCount: 1, maxAttempts: 3 }).toState).toBe(
      "PAYMENT_PENDING",
    );
    expect(() => go("PAYMENT_FAILED", "RETRY", { attemptCount: 3, maxAttempts: 3 })).toThrow(
      DomainError,
    );
    expect(go("EXPIRED", "RETRY", { attemptCount: 0 }).toState).toBe("PAYMENT_PENDING");
  });

  it("retries a payout only after Payaza confirms failure, and preserves refund intent", () => {
    expect(() => go("PAYOUT_FAILED", "RETRY_PAYOUT", { payazaConfirmedFailure: false })).toThrow(
      /NIP_FAILURE/,
    );
    expect(
      go("PAYOUT_FAILED", "RETRY_PAYOUT", { payazaConfirmedFailure: true, payoutIntent: "RELEASE" })
        .toState,
    ).toBe("RELEASE_PENDING");
    expect(
      go("PAYOUT_FAILED", "RETRY_PAYOUT", { payazaConfirmedFailure: true, payoutIntent: "REFUND" })
        .toState,
    ).toBe("REFUND_PENDING");
  });

  it("adjudicates disputes into release, refund, or split", () => {
    expect(go("DISPUTED", "RESOLVE_RELEASE").effects).toContain("CREATE_RELEASE_PAYOUT");
    expect(go("DISPUTED", "RESOLVE_REFUND").toState).toBe("REFUND_PENDING");
    expect(go("DISPUTED", "RESOLVE_SPLIT").toState).toBe("SPLIT_PENDING");
    expect(go("REFUND_PENDING", "PAYOUT_SUCCEEDED").toState).toBe("REFUNDED");
    expect(go("SPLIT_PENDING", "PAYOUT_SUCCEEDED").toState).toBe("PAID_OUT");
  });

  it("hashes the payload into the event", () => {
    const event = go("DRAFT", "ISSUE", { payload: { invoice: "inv_1" } });
    expect(event.payloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(event.fromState).toBe("DRAFT");
  });

  it("has no silent edges out of terminal success states", () => {
    for (const state of ["PAID_OUT", "REFUNDED", "CANCELLED"] as TradeState[]) {
      expect(TRANSITIONS[state]).toEqual([]);
      expect(() => go(state, "SHIP")).toThrow(DomainError);
    }
  });
});
