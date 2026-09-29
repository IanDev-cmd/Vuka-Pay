import PgBoss from "pg-boss";
import { VukaService } from "@vukapay/core";
import { PrismaRepository, createPrismaClient } from "@vukapay/db";
import { loadConfig, createNotifier, createRails } from "@vukapay/api";

async function processInbox(service: VukaService, repo: PrismaRepository) {
  const events = await repo.unprocessedPayazaEvents();
  for (const event of events) {
    try {
      await service.ingestPayazaBody(event.rawBody);
      await repo.markPayazaEvent(event.id, null);
    } catch (error) {
      await repo.markPayazaEvent(event.id, error instanceof Error ? error.message : "process failed");
    }
  }
}

async function main() {
  const config = loadConfig();
  if (!config.DATABASE_URL) throw new Error("DATABASE_URL is required for the worker");
  const repo = new PrismaRepository(createPrismaClient());
  const service = new VukaService({
    repo,
    rails: createRails(config, (event) => console.log(JSON.stringify(event))),
    notifier: createNotifier(config),
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
  const boss = new PgBoss(config.DATABASE_URL);
  await boss.start();
  await boss.createQueue("payaza-inbox");
  await boss.schedule("payaza-inbox", "* * * * *");
  await boss.work("payaza-inbox", async () => {
    await processInbox(service, repo);
  });
  console.log("worker started");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
