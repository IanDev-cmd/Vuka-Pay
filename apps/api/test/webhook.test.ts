import { describe, expect, it } from "vitest";
import { VukaService } from "@vukapay/core";
import { MemoryRepository } from "../../../packages/core/test/memory.ts";
import { loadConfig } from "../src/config.js";
import { buildServer } from "../src/server.js";

describe("payaza webhook route", () => {
  it("rejects a missing signature before processing", async () => {
    const config = loadConfig({
      APP_SECRET: "test-secret-test-secret-test-secret",
      PAYAZA_SECRET_KEY: "secret",
      DATABASE_URL: "postgresql://unused",
    });
    const repo = new MemoryRepository();
    const service = new VukaService({
      repo,
      rails: {
        async processCollection() { return { response_code: "09" }; },
        async checkCollection() { return { response_code: "09" }; },
        async initiatePayout() { return { raw: {} }; },
        async payoutStatus() { return { raw: {} }; },
        async kesAccount() { return null; },
        async kesMobileMoneyCode() { return "X"; },
        async fundTest() { return { response_code: "00" }; },
        async stkPush() { return { checkoutRequestId: "ws_test", merchantRequestId: "m" }; },
        async stkQuery() { return { pending: true }; },
      },
      notifier: { async sms() { throw new Error("no"); } },
      config: {
        appSecret: config.APP_SECRET,
        spreadBps: 100,
        quoteTtlSeconds: 900,
        maxDeviationBps: 150,
        maxRateAgeSeconds: 129600,
        feeBps: 100,
        feeMinMinor: 0n,
        feeMaxMinor: 0n,
        settlementMode: "none",
        maxOpenExposureMinor: 0n,
        maxInvoiceKesMinor: 1n,
        firstPayoutKesMinor: 1n,
        maxPayoutsPerDay: 1,
        coolingSeconds: 1,
        collectionNetworks: [],
        smsConfigured: false,
        creditEnabled: false,
        creditMinRecords: 5,
        disputeWindowSeconds: 60,
        tenant: "test",
      },
    });
    const app = await buildServer({ config, repo, service });
    const response = await app.inject({
      method: "POST",
      url: "/api/webhooks/payaza",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ transaction_reference: "VK-TEST" }),
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("UNAUTHENTICATED");
    expect(repo.state.payazaEvents[0]?.signatureOk).toBe(false);
    expect(repo.state.journals).toHaveLength(0);
    await app.close();
  });
});
