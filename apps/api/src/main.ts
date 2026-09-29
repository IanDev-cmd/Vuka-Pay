import { readFileSync } from "node:fs";
import { VukaService } from "@vukapay/core";
import { PrismaRepository, createPrismaClient } from "@vukapay/db";
import { loadConfig } from "./config.js";
import { fxFeedsHealthy } from "./rates.js";
import { createNotifier, createRails } from "./rails.js";
import { buildServer } from "./server.js";

async function main() {
  const config = loadConfig();
  let repo: PrismaRepository | null = null;
  let service: VukaService | null = null;
  if (config.DATABASE_URL) {
    const prisma = createPrismaClient();
    repo = new PrismaRepository(prisma);
    let verification = {};
    try {
      verification = JSON.parse(readFileSync(new URL("../../../docs/verification-log.json", import.meta.url), "utf8"));
    } catch {
      verification = {};
    }
    service = new VukaService({
      repo,
      rails: createRails(config, (event) => console.log(JSON.stringify(event))),
      notifier: createNotifier(config),
      verification,
      fxProbe: fxFeedsHealthy,
      config: {
        appSecret: config.APP_SECRET,
        spreadBps: config.FX_SPREAD_BPS,
        quoteTtlSeconds: config.FX_QUOTE_TTL_SECONDS,
        maxDeviationBps: config.FX_MAX_SOURCE_DEVIATION_BPS,
        maxRateAgeSeconds: config.FX_MAX_RATE_AGE_SECONDS,
        feeBps: config.FEE_BPS,
        feeMinMinor: BigInt(config.FEE_MIN_KES_MINOR),
        feeMaxMinor: BigInt(config.FEE_MAX_KES_MINOR),
        settlementMode: config.settlementMode,
        maxOpenExposureMinor: BigInt(config.FX_MAX_OPEN_EXPOSURE_KES_MINOR),
        maxInvoiceKesMinor: BigInt(config.RISK_MAX_INVOICE_KES_MINOR),
        firstPayoutKesMinor: BigInt(config.RISK_FIRST_PAYOUT_KES_MINOR),
        maxPayoutsPerDay: config.RISK_MAX_PAYOUTS_PER_DAY,
        coolingSeconds: config.RISK_PAYOUT_COOLING_SECONDS,
        collectionNetworks: config.collectionNetworks,
        kesMomoBankCode: config.PAYAZA_KES_MOMO_BANK_CODE,
        transactionPin: config.PAYAZA_TRANSACTION_PIN,
        smsConfigured: config.smsConfigured,
        creditEnabled: config.CREDIT_ENABLED === "true",
        creditMinRecords: config.CREDIT_MIN_RECORDS,
        disputeWindowSeconds: config.DISPUTE_WINDOW_SECONDS,
        tenant: config.PAYAZA_TENANT,
      },
    });
  }
  const app = await buildServer({ config, repo, service });
  await app.listen({ port: config.PORT, host: "0.0.0.0" });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
