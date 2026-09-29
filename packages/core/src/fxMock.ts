import { issueKesQuote, issueQuote, observationsFromUsdLegs, type FxQuote, type QuoteConfig, type RateObservation } from "./fx.js";

/** Demo USD book. Two sources stay inside the 150 bps deviation gate. Not a live feed. */
export const MOCK_USD_BOOK = [
  { source: "mock-exchangerate", kesPerUsd: "129.25", UGX: "3780", TZS: "2650", RWF: "1370" },
  { source: "mock-fawaz", kesPerUsd: "129.40", UGX: "3792", TZS: "2658", RWF: "1374" },
] as const;

export const DEMO_GOODS_MINOR = 4_500_000n;

/** 200 bps of 45,000 KES is the 900 KES fee on the demo invoice. */
export const DEMO_QUOTE_CONFIG: QuoteConfig = {
  spreadBps: 150,
  ttlSeconds: 900,
  maxDeviationBps: 150,
  maxRateAgeSeconds: 129_600,
  fee: { bps: 200, minMinor: 0n, maxMinor: 0n },
};

export function mockObservations(quote: "UGX" | "TZS" | "RWF", now = new Date()): RateObservation[] {
  return observationsFromUsdLegs(
    MOCK_USD_BOOK.map((row) => ({
      source: row.source,
      kesPerUsd: row.kesPerUsd,
      quotePerUsd: row[quote],
      asOf: now,
    })),
    quote,
  );
}

/** Same median, spread, and fee path as a live quote. Rates come from the demo book. */
export function quoteMock(input: {
  itemsMinor: bigint;
  to: "KES" | "UGX" | "TZS" | "RWF";
  now?: Date;
  config?: QuoteConfig;
}): FxQuote {
  const now = input.now ?? new Date();
  const config = input.config ?? DEMO_QUOTE_CONFIG;
  if (input.to === "KES") return issueKesQuote({ itemsMinor: input.itemsMinor, config, now });
  return issueQuote({
    itemsMinor: input.itemsMinor,
    to: input.to,
    observations: mockObservations(input.to, now),
    config,
    now,
  });
}
