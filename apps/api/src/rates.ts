import { DomainError, quotePerKes, type RateObservation } from "@vukapay/core";

let fxProbeCache: { ok: boolean; at: number } | null = null;

/** True only after both configured feeds return KES, UGX, and TZS. Cached for five minutes. */
export async function fxFeedsHealthy(now = Date.now()): Promise<boolean> {
  if (fxProbeCache && now - fxProbeCache.at < 300_000) return fxProbeCache.ok;
  try {
    await loadObservations("UGX");
    fxProbeCache = { ok: true, at: now };
    return true;
  } catch {
    fxProbeCache = { ok: false, at: now };
    return false;
  }
}

export async function loadObservations(quote: "UGX" | "TZS", now = new Date()): Promise<RateObservation[]> {
  const [exchange, fawaz] = await Promise.allSettled([exchangeRateApi(now), fawazRate(quote, now)]);
  const observations: RateObservation[] = [];
  for (const result of [exchange, fawaz]) {
    if (result.status === "fulfilled" && result.value) {
      const leg = result.value;
      observations.push({
        source: leg.source,
        asOf: leg.asOf,
        rate: quotePerKes(leg.kesPerUsd, quote === "UGX" ? leg.ugxPerUsd : leg.tzsPerUsd),
      });
    }
  }
  if (observations.length < 2) {
    throw new DomainError("FX_RATE_UNAVAILABLE", "Fewer than two fresh FX sources responded", 503, {
      sources: observations.map((row) => row.source),
    });
  }
  return observations;
}

async function exchangeRateApi(now: Date) {
  const response = await fetch("https://open.er-api.com/v6/latest/USD");
  if (!response.ok) throw new Error(`exchangerate-api ${response.status}`);
  const body = (await response.json()) as {
    result?: string;
    time_last_update_unix?: number;
    rates?: { KES?: number; UGX?: number; TZS?: number };
  };
  if (body.result !== "success" || !body.rates?.KES || !body.rates.UGX || !body.rates.TZS) {
    throw new Error("exchangerate-api missing KES/UGX/TZS");
  }
  return {
    source: "exchangerate-api",
    asOf: body.time_last_update_unix ? new Date(body.time_last_update_unix * 1000) : now,
    kesPerUsd: String(body.rates.KES),
    ugxPerUsd: String(body.rates.UGX),
    tzsPerUsd: String(body.rates.TZS),
  };
}

async function fawazRate(_quote: "UGX" | "TZS", _now: Date) {
  const response = await fetch("https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json");
  if (!response.ok) throw new Error(`fawazahmed0 ${response.status}`);
  const body = (await response.json()) as { date?: string; usd?: { kes?: number; ugx?: number; tzs?: number } };
  if (!body.usd?.kes || !body.usd.ugx || !body.usd.tzs || !body.date) throw new Error("fawazahmed0 missing rates");
  return {
    source: "fawazahmed0",
    asOf: new Date(`${body.date}T00:00:00.000Z`),
    kesPerUsd: String(body.usd.kes),
    ugxPerUsd: String(body.usd.ugx),
    tzsPerUsd: String(body.usd.tzs),
  };
}
