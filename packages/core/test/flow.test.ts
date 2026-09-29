import { describe, expect, it } from "vitest";
import { DomainError, VukaService, type Rails } from "../src/index.js";
import { MemoryRepository } from "./memory.js";
import { readTradeToken } from "../src/auth.js";

const now = new Date("2026-09-28T12:00:00.000Z");

function rails(status: string): Rails & { payouts: unknown[] } {
  const payouts: unknown[] = [];
  return {
    payouts,
    async processCollection() {
      return { response_code: "09", response_message: "PENDING" };
    },
    async checkCollection() {
      return { response_code: "09", transaction_status: "Initialized" };
    },
    async initiatePayout(input) {
      payouts.push(input);
      return { response_status: "TRANSACTION_INITIATED", raw: { response_status: "TRANSACTION_INITIATED" } };
    },
    async payoutStatus() {
      return { transactionStatus: status, fee: 1, raw: { transactionStatus: status } };
    },
    async kesAccount() {
      return { payazaAccountReference: "1010000009", postNoDebit: false, accountBalance: 1_000_000, currency: "KES" };
    },
    async kesMobileMoneyCode(pinned) {
      if (pinned !== "SAFKEN") throw new DomainError("CAPABILITY_GATED", "pinned code was not returned by Payaza bank codes", 409);
      return pinned;
    },
    async fundTest() {
      return { response_code: "00", response_message: "Account Successfully Funded" };
    },
    async stkPush() {
      return { checkoutRequestId: "ws_test", merchantRequestId: "m", customerMessage: "ok" };
    },
    async stkQuery() {
      return { pending: true };
    },
  };
}

function service(repo: MemoryRepository, sms: string[], status = "NIP_SUCCESS") {
  return new VukaService({
    repo,
    rails: rails(status),
    notifier: { async sms(_to, body) { sms.push(body); } },
    now: () => now,
    fxProbeOk: true,
    config: {
      appSecret: "test-secret-test-secret-test-secret",
      spreadBps: 100,
      quoteTtlSeconds: 900,
      maxDeviationBps: 200,
      maxRateAgeSeconds: 129600,
      feeBps: 100,
      feeMinMinor: 0n,
      feeMaxMinor: 0n,
      settlementMode: "treasury_float",
      maxOpenExposureMinor: 100_000_000n,
      maxInvoiceKesMinor: 50_000_000n,
      firstPayoutKesMinor: 50_000_000n,
      maxPayoutsPerDay: 10,
      coolingSeconds: 86400,
      collectionNetworks: [
        { currency: "UGX", country: "UG", code: "UNITUG", displayName: "unit", source: "unit fixture, not a Payaza code" },
      ],
      kesMomoBankCode: "SAFKEN",
      transactionPin: "419374",
      smsConfigured: true,
      creditEnabled: true,
      creditMinRecords: 5,
      disputeWindowSeconds: 3600,
      tenant: "test",
    },
  });
}

describe("trade flow", () => {
  it("locks funds on an exact collection and pays out only after delivery", async () => {
    const repo = new MemoryRepository();
    const sms: string[] = [];
    const app = service(repo, sms);
    const auth = await app.register({ email: "exporter@example.com", password: "correct horse", displayName: "Amina Exports", language: "en" });
    const user = app.requireAccessToken(`Bearer ${auth.access_token}`);
    await app.updateBusiness(user.sub, { legalName: "Amina Exports", tradingName: "Amina", nationalIdNumber: "12345678" });
    const method = await app.addPayoutMethod(user.sub, { phone: "0712345678", accountName: "Amina Exports" });
    await app.sendPayoutOtp(user.sub, method.id, "sw");
    const otp = sms.at(-1)?.match(/\d{6}/)?.[0] ?? "";
    await app.verifyPayoutOtp(user.sub, method.id, otp);
    const invoice = await app.createInvoice(user.sub, {
      items: [{ description: "Avocados", quantity: 10, unitMinor: 10_000n }],
      buyer: { name: "Kato Buyers", phone: "0712345678", country: "UG", currency: "UGX", network: "UNITUG" },
      observations: [
        { source: "exchangerate-api", rate: "30", asOf: now },
        { source: "fawazahmed0", rate: "30.1", asOf: now },
      ],
    });
    expect(invoice.buyer_amount.currency).toBe("UGX");
    expect(invoice.fee_breakdown.payaza_processing).toBe("recorded_on_settlement");
    const sent = await app.sendInvoice(user.sub, invoice.id, "en");
    const token = sent.pay_url.split("/").at(-1) ?? "";
    readTradeToken(token, "test-secret-test-secret-test-secret");
    const prompt = await app.collect(token, { phone: "+256 712 345 678", networkCode: "UNITUG" });
    expect(prompt.status).toBe("PENDING");
    const reference = repo.state.collections[0]?.transactionReference ?? "";
    const quoted = BigInt(invoice.buyer_amount.amount_minor);
    const first = await app.applyCollectionWebhook({
      transactionReference: reference,
      transactionStatus: "Funds Received",
      status: "Completed",
      amountValidation: "EXACT",
      amountReceived: Number(quoted),
      transactionFee: 0,
      currency: "UGX",
      dedupeKey: `${reference}:Completed`,
    });
    expect(first.state).toBe("FUNDED");
    const duplicate = await app.applyCollectionWebhook({
      transactionReference: reference,
      transactionStatus: "Funds Received",
      status: "Completed",
      amountValidation: "EXACT",
      amountReceived: Number(quoted),
      transactionFee: 0,
      currency: "UGX",
      dedupeKey: `${reference}:Completed`,
    });
    expect(duplicate.reason).toBe("duplicate");
    expect(repo.state.journals.filter((row) => row.kind === "COLLECTION")).toHaveLength(1);
    await app.ship(user.sub, sent.trade.id, { waybillNo: "WB1" });
    await app.deliveryClaim(user.sub, sent.trade.id);
    const code = sms.at(-1)?.match(/\d{6}/)?.[0] ?? "";
    const paid = await app.confirmDelivery(token, code);
    expect(paid.state === "RELEASE_PENDING" || paid.state === "PAID_OUT").toBe(true);
    const payout = repo.state.payouts[0];
    expect(payout?.status).toBe("PENDING");
    await app.recheckPayout(await adminId(repo, app), payout!.id);
    const done = await app.getTrade(user.sub, sent.trade.id);
    expect(done.state).toBe("PAID_OUT");
    const score = await app.creditScore(user.sub);
    expect(score.status).toBe("insufficient_history");
  });

  it("refuses a cross-currency invoice when settlement is off", async () => {
    const repo = new MemoryRepository();
    const app = service(repo, []);
    const config = (app as unknown as { deps: { config: { settlementMode: string } } }).deps.config;
    config.settlementMode = "none";
    const auth = await app.register({ email: "b@example.com", password: "correct horse", displayName: "Bee", language: "en" });
    const user = app.requireAccessToken(`Bearer ${auth.access_token}`);
    await app.updateBusiness(user.sub, { legalName: "Bee", tradingName: "Bee", nationalIdNumber: "99" });
    await expect(
      app.createInvoice(user.sub, {
        items: [{ description: "Cloth", quantity: 1, unitMinor: 5_000n }],
        buyer: { name: "Buyer", phone: "0712345678", country: "UG", currency: "UGX" },
        observations: [
          { source: "a", rate: "20", asOf: now },
          { source: "b", rate: "20.1", asOf: now },
        ],
      }),
    ).rejects.toMatchObject({ code: "FX_SETTLEMENT_UNAVAILABLE" });
  });

  it("rejects an unverified collection network before calling Payaza", async () => {
    const repo = new MemoryRepository();
    const sms: string[] = [];
    const app = service(repo, sms);
    const auth = await app.register({ email: "c@example.com", password: "correct horse", displayName: "Cee", language: "en" });
    const user = app.requireAccessToken(`Bearer ${auth.access_token}`);
    await app.updateBusiness(user.sub, { legalName: "Cee", tradingName: "Cee", nationalIdNumber: "99" });
    const method = await app.addPayoutMethod(user.sub, { phone: "0712345678", accountName: "Cee" });
    await app.sendPayoutOtp(user.sub, method.id, "en");
    await app.verifyPayoutOtp(user.sub, method.id, sms.at(-1)?.match(/\d{6}/)?.[0] ?? "");
    const invoice = await app.createInvoice(user.sub, {
      items: [{ description: "Tea", quantity: 1, unitMinor: 20_000n }],
      buyer: { name: "Buyer", phone: "0712345678", country: "UG", currency: "UGX" },
      observations: [
        { source: "a", rate: "30", asOf: now },
        { source: "b", rate: "30", asOf: now },
      ],
    });
    const sent = await app.sendInvoice(user.sub, invoice.id, "en");
    const token = sent.pay_url.split("/").at(-1) ?? "";
    await expect(app.collect(token, { phone: "256712345678", networkCode: "GUESSED" })).rejects.toMatchObject({
      code: "CAPABILITY_GATED",
    });
    expect(repo.state.collections).toHaveLength(0);
  });
});

async function adminId(repo: MemoryRepository, app: VukaService) {
  repo.state.users[0]!.role = "ADMIN";
  const auth = await app.login({ email: "exporter@example.com", password: "correct horse" });
  return app.requireAccessToken(`Bearer ${auth.access_token}`).sub;
}
