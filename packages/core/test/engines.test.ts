import { describe, expect, it } from "vitest";
import { DomainError } from "../src/errors.js";
import { decideCollection } from "../src/collectionDecision.js";
import {
  journalCollection,
  journalKesObligation,
  journalPayout,
  journalRefundPayout,
  journalTreasuryConversion,
  openExposureKes,
  reconcile,
  UnbalancedJournalError,
} from "../src/ledger.js";
import { availableActions } from "../src/actions.js";
import { FEE_ALLOCATION, feeBreakdown } from "../src/fees.js";
import { issueQuote, observationsFromUsdLegs } from "../src/fx.js";
import { quoteMock } from "../src/fxMock.js";
import { normalizePhone } from "../src/phone.js";
import { minorToPayazaNumber, payazaNumberToMinor } from "../src/money.js";
import { assertCollectionNetwork, DOCUMENTED_COLLECTION_NETWORKS } from "../src/corridors.js";
import { scoreTradeRecords } from "../src/credit.js";
import { deliveryCode, deliveryCodeMatches } from "../src/ids.js";

describe("money and phones", () => {
  it("round-trips KES minor units through a Payaza major number", () => {
    expect(minorToPayazaNumber(150050n, "KES")).toBe(1500.5);
    expect(payazaNumberToMinor(1500.5, "KES")).toBe(150050n);
    expect(payazaNumberToMinor(200, "UGX")).toBe(200n);
  });

  it("normalizes KE UG and TZ numbers to 12 digits", () => {
    expect(normalizePhone("+254 712 345 678", "KE")).toBe("254712345678");
    expect(normalizePhone("0712345678", "KE")).toBe("254712345678");
    expect(normalizePhone("256712345678", "UG")).toBe("256712345678");
    expect(normalizePhone("0712 345 678", "TZ")).toBe("255712345678");
    expect(() => normalizePhone("12345", "UG")).toThrow(DomainError);
  });
});

describe("fees quotes and collection amounts", () => {
  it("deducts the VukaPay fee from the exporter on every screen", () => {
    expect(FEE_ALLOCATION).toBe("deducted_from_exporter");
    const fees = feeBreakdown(4_500_000n, { bps: 200, minMinor: 0n, maxMinor: 0n });
    expect(fees.vukapayFeeMinor).toBe(90_000n);
    expect(fees.exporterNetMinor).toBe(4_410_000n);
    expect(fees.payazaFee).toBe("recorded_on_settlement");
  });

  it("lists actions from the trade state and the viewer", () => {
    expect(availableActions("DRAFT", "exporter")).toEqual(["send_invoice"]);
    expect(availableActions("DRAFT", "buyer")).toEqual([]);
    expect(availableActions("AWAITING_PAYMENT", "buyer")).toEqual(["continue_to_payment"]);
    expect(availableActions("AWAITING_PAYMENT", "exporter")).toEqual([]);
    expect(availableActions("FUNDED", "exporter")).toEqual(["ship", "add_evidence"]);
    expect(availableActions("SHIPPED", "buyer")).toEqual(["confirm_delivery", "dispute", "view_evidence"]);
  });

  const config = {
    spreadBps: 100,
    ttlSeconds: 900,
    maxDeviationBps: 150,
    maxRateAgeSeconds: 129_600,
    fee: { bps: 250, minMinor: 0n, maxMinor: 0n },
  };
  const now = new Date("2026-09-28T12:00:00.000Z");

  it("charges a bounded percentage and locks exporter net", () => {
    const fees = feeBreakdown(100_000n, { bps: 250, minMinor: 5_000n, maxMinor: 1_000n });
    expect(fees.vukapayFeeMinor).toBe(1_000n);
    expect(fees.exporterNetMinor).toBe(99_000n);
    expect(fees.payazaFee).toBe("recorded_on_settlement");
  });

  it("uses the median of two sources and rounds UGX to whole units", () => {
    const observations = observationsFromUsdLegs(
      [
        { source: "a", kesPerUsd: "100", quotePerUsd: "3000", asOf: now },
        { source: "b", kesPerUsd: "100", quotePerUsd: "3002", asOf: now },
      ],
      "UGX",
    );
    const quote = issueQuote({ itemsMinor: 100_000n, to: "UGX", observations, config, now });
    expect(quote.buyerAmountMinor > 0n).toBe(true);
    expect(quote.sources).toEqual(["a", "b"]);
    expect(quote.exporterNetKesMinor).toBe(97_500n);
  });

  it("prices the demo invoice through the quote engine on the mock book", () => {
    const quote = quoteMock({ itemsMinor: 4_500_000n, to: "UGX", now });
    expect(quote.sources).toEqual(["mock-exchangerate", "mock-fawaz"]);
    expect(quote.feeMinor).toBe(90_000n);
    expect(quote.exporterNetKesMinor).toBe(4_410_000n);
    expect(quote.buyerAmountMinor > 1_000_000n).toBe(true);
    expect(quoteMock({ itemsMinor: 10_000n, to: "KES", now }).midRate).toBe("1");
    expect(quoteMock({ itemsMinor: 10_000n, to: "TZS", now }).buyerAmountMinor > 0n).toBe(true);
    expect(quoteMock({ itemsMinor: 10_000n, to: "RWF", now }).buyerAmountMinor > 0n).toBe(true);
  });

  it("fails closed when a source is stale or they diverge", () => {
    const stale = new Date("2026-01-01T00:00:00.000Z");
    expect(() =>
      issueQuote({
        itemsMinor: 100_000n,
        to: "TZS",
        observations: [
          { source: "a", rate: "20", asOf: stale },
          { source: "b", rate: "20", asOf: now },
        ],
        config,
        now,
      }),
    ).toThrowError(DomainError);

    expect(() =>
      issueQuote({
        itemsMinor: 100_000n,
        to: "UGX",
        observations: [
          { source: "a", rate: "20", asOf: now },
          { source: "b", rate: "30", asOf: now },
        ],
        config,
        now,
      }),
    ).toThrow(/deviate/);
  });

  it("branches amount_validation and fails closed on a missing label", () => {
    expect(
      decideCollection({
        validation: "EXACT",
        amountReceivedMinor: 1000n,
        quotedMinor: 1000n,
        alreadyHeldMinor: 0n,
      }).command,
    ).toBe("PAYMENT_EXACT");
    expect(
      decideCollection({
        validation: "UNDERPAYMENT",
        amountReceivedMinor: 400n,
        quotedMinor: 1000n,
        alreadyHeldMinor: 0n,
      }).command,
    ).toBe("PAYMENT_UNDER");
    expect(
      decideCollection({
        validation: "UNDERPAYMENT",
        amountReceivedMinor: 600n,
        quotedMinor: 1000n,
        alreadyHeldMinor: 400n,
      }).command,
    ).toBe("TOP_UP");
    const over = decideCollection({
      validation: "OVERPAYMENT",
      amountReceivedMinor: 1200n,
      quotedMinor: 1000n,
      alreadyHeldMinor: 0n,
    });
    expect(over.holdMinor).toBe(1000n);
    expect(over.refundMinor).toBe(200n);
    expect(() =>
      decideCollection({
        validation: undefined,
        amountReceivedMinor: 1000n,
        quotedMinor: 1000n,
        alreadyHeldMinor: 0n,
      }),
    ).toThrow(/amount_validation/);
  });
});

describe("ledger", () => {
  it("balances collection, obligation, payout, refund, and conversion", () => {
    const collection = journalCollection({
      currency: "UGX",
      amountReceivedMinor: 1200n,
      feeMinor: 10n,
      holdMinor: 1000n,
      refundMinor: 200n,
      tradeId: "trd_1",
    });
    expect(collection.lines.length).toBeGreaterThan(0);
    const obligation = journalKesObligation({
      exporterNetMinor: 97_500n,
      feeMinor: 2_500n,
      tradeId: "trd_1",
    });
    expect(openExposureKes([{ account: "FX_CLEARING", currency: "KES", debitMinor: 100_000n, creditMinor: 0n }])).toBe(
      100_000n,
    );
    journalPayout({ amountMinor: 97_500n, feeMinor: 15n, tradeId: "trd_1" });
    journalRefundPayout({
      currency: "UGX",
      amountMinor: 1000n,
      feeMinor: 0n,
      tradeId: "trd_1",
      reverseKesObligation: { exporterNetMinor: 97_500n, feeMinor: 2_500n },
    });
    journalTreasuryConversion({
      sellCurrency: "UGX",
      sellMinor: 1000n,
      buyCurrency: "KES",
      buyMinor: 50_000n,
      releaseHold: true,
    });
    expect(obligation.kind).toBe("KES_OBLIGATION");
  });

  it("rejects an unbalanced collection split", () => {
    expect(() =>
      journalCollection({
        currency: "TZS",
        amountReceivedMinor: 100n,
        feeMinor: 1n,
        holdMinor: 80n,
        refundMinor: 10n,
        tradeId: "trd_2",
      }),
    ).toThrow(UnbalancedJournalError);
  });

  it("flags ledger drift against Payaza balances", () => {
    const flags = reconcile({
      ledger: [{ account: "BUYER_CLEARING", currency: "KES", debitMinor: 500n, creditMinor: 100n }],
      payaza: [{ currency: "KES", balanceMinor: 350n }],
    });
    expect(flags).toHaveLength(1);
    expect(flags[0]?.driftMinor).toBe(50n);
  });
});

describe("codes, credit, delivery", () => {
  it("rejects collection network codes that are not on the verified list", () => {
    expect(assertCollectionNetwork([...DOCUMENTED_COLLECTION_NETWORKS], "KES", "SAFKEN").code).toBe(
      "SAFKEN",
    );
    expect(() => assertCollectionNetwork([...DOCUMENTED_COLLECTION_NETWORKS], "UGX", "MTNUG")).toThrow(
      /not in the verified/,
    );
  });

  it("returns insufficient_history until the threshold, then reason codes", () => {
    const one = scoreTradeRecords(
      [
        {
          id: "1",
          terminalState: "PAID_OUT",
          corridor: "KE-UG",
          onTime: true,
          disputed: false,
          disputeOutcome: null,
          counterpartyKey: "b1",
          completedAt: new Date(),
          amountKesMinor: 100n,
        },
      ],
      5,
    );
    expect(one.status).toBe("insufficient_history");
    const many = scoreTradeRecords(
      Array.from({ length: 5 }, (_, index) => ({
        id: String(index),
        terminalState: "PAID_OUT" as const,
        corridor: "KE-TZ",
        onTime: true,
        disputed: false,
        disputeOutcome: null,
        counterpartyKey: `b${index}`,
        completedAt: new Date(),
        amountKesMinor: 100n,
      })),
      5,
    );
    expect(many.status).toBe("scored");
    expect(many.disclaimer).toMatch(/not a credit approval/);
    expect(many.score).not.toBeNull();
  });

  it("matches a delivery code without storing it in the clear comparison", () => {
    const issued = deliveryCode();
    expect(deliveryCodeMatches(issued.code, issued.hash)).toBe(true);
    expect(deliveryCodeMatches("000000", issued.hash)).toBe(false);
  });
});
