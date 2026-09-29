import { z } from "zod";
import {
  CORRIDORS,
  CURRENCY_META,
  DOCUMENTED_COLLECTION_NETWORKS,
  MPESA_STK_NETWORK,
  EXPONENTS,
  type CollectionNetwork,
  type Currency,
} from "@vukapay/core";

const Env = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.string().default("development"),
  DATABASE_URL: z.string().optional(),
  PAYAZA_TENANT: z.enum(["test", "live"]).default("test"),
  PAYAZA_BASE_URL: z.string().default("https://api.payaza.africa/live/"),
  PAYAZA_PUBLIC_KEY: z.string().optional(),
  PAYAZA_SECRET_KEY: z.string().optional(),
  PAYAZA_TRANSACTION_PIN: z.string().optional(),
  PAYAZA_SIGN_PAYOUTS: z.enum(["true", "false"]).default("false"),
  APP_SECRET: z.string().min(32).default("dev-only-secret-change-me-please-32"),
  FX_MODE: z.enum(["live", "mock"]).optional(),
  FX_SPREAD_BPS: z.coerce.number().default(150),
  FX_QUOTE_TTL_SECONDS: z.coerce.number().default(900),
  FX_MAX_SOURCE_DEVIATION_BPS: z.coerce.number().default(150),
  FX_MAX_RATE_AGE_SECONDS: z.coerce.number().default(129600),
  FX_SETTLEMENT_MODE: z.enum(["", "treasury_float"]).default(""),
  FX_MAX_OPEN_EXPOSURE_KES_MINOR: z.string().default("0"),
  FEE_BPS: z.coerce.number().default(150),
  FEE_MIN_KES_MINOR: z.string().default("0"),
  FEE_MAX_KES_MINOR: z.string().default("0"),
  RISK_MAX_INVOICE_KES_MINOR: z.string().default("50000000"),
  RISK_FIRST_PAYOUT_KES_MINOR: z.string().default("20000000"),
  RISK_MAX_PAYOUTS_PER_DAY: z.coerce.number().default(10),
  RISK_PAYOUT_COOLING_SECONDS: z.coerce.number().default(86400),
  CREDIT_ENABLED: z.enum(["true", "false"]).default("false"),
  CREDIT_MIN_RECORDS: z.coerce.number().default(5),
  AT_USERNAME: z.string().optional(),
  AT_API_KEY: z.string().optional(),
  AT_SENDER_ID: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM: z.string().optional(),
  PAYAZA_COLLECTION_CODES_JSON: z.string().optional(),
  PAYAZA_KES_MOMO_BANK_CODE: z.string().optional(),
  PUBLIC_APP_URL: z.string().default("http://localhost:3000"),
  DISPUTE_WINDOW_SECONDS: z.coerce.number().default(172800),
  MPESA_CONSUMER_KEY: z.string().optional(),
  MPESA_CONSUMER_SECRET: z.string().optional(),
  MPESA_SHORTCODE: z.string().optional(),
  MPESA_PASSKEY: z.string().optional(),
  MPESA_BASE_URL: z.string().optional(),
  MPESA_CALLBACK_URL: z.string().optional(),
});

export type AppConfig = z.infer<typeof Env> & {
  settlementMode: "none" | "treasury_float";
  collectionNetworks: CollectionNetwork[];
  smsConfigured: boolean;
};

/** Live feeds in production. The demo book elsewhere, unless FX_MODE is set. */
export function fxMode(env: NodeJS.ProcessEnv = process.env): "live" | "mock" {
  if (env.FX_MODE === "live" || env.FX_MODE === "mock") return env.FX_MODE;
  return env.NODE_ENV === "production" ? "live" : "mock";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = Env.parse(env);
  const extra = parseNetworks(parsed.PAYAZA_COLLECTION_CODES_JSON);
  return {
    ...parsed,
    settlementMode: parsed.FX_SETTLEMENT_MODE === "treasury_float" ? "treasury_float" : "none",
    collectionNetworks: [...DOCUMENTED_COLLECTION_NETWORKS, ...extra, MPESA_STK_NETWORK],
    smsConfigured: Boolean((parsed.AT_USERNAME && parsed.AT_API_KEY) || (parsed.TWILIO_ACCOUNT_SID && parsed.TWILIO_AUTH_TOKEN && parsed.TWILIO_FROM)),
  };
}

function parseNetworks(raw: string | undefined): CollectionNetwork[] {
  if (!raw) return [];
  const parsed = z
    .array(
      z.object({
        currency: z.enum(["KES", "UGX", "TZS", "RWF", "USD"]),
        country: z.enum(["KE", "UG", "TZ", "RW"]),
        code: z.string().min(1),
        display_name: z.string().min(1),
        source: z.string().min(8),
      }),
    )
    .parse(JSON.parse(raw));
  return parsed.map((row) => ({
    currency: row.currency,
    country: row.country,
    code: row.code,
    displayName: row.display_name,
    source: row.source,
  }));
}

export function currencyCatalog() {
  return (Object.keys(EXPONENTS) as Currency[]).map((code) => ({
    code,
    exponent: EXPONENTS[code],
    symbol: CURRENCY_META[code].symbol,
    name: CURRENCY_META[code].name,
  }));
}

export function corridorCatalog(networks: CollectionNetwork[]) {
  return CORRIDORS.map((corridor) => ({
    id: corridor.id,
    collection_currency: corridor.collectionCurrency,
    payout_currency: corridor.payoutCurrency,
    buyer_country: corridor.buyerCountry,
    phone: {
      prefix: corridor.buyerCountry === "KE" ? "254" : corridor.buyerCountry === "UG" ? "256" : corridor.buyerCountry === "RW" ? "250" : "255",
      digits: 12,
    },
    networks: networks
      .filter((row) => row.currency === corridor.collectionCurrency)
      .map((row) => ({ code: row.code, display_name: row.displayName })),
    payout_transaction_type: corridor.payoutTransactionType,
    limits: "VukaPay risk limits are configuration. Payaza corridor caps are not published in the docs we verified.",
  }));
}
