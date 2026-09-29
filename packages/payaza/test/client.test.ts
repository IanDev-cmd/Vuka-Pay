import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PayazaError } from "../src/errors.js";
import { PayazaHttp } from "../src/http.js";
import { collectionOutcome } from "../src/collections.js";
import { payoutStatusGroup } from "../src/transfers.js";
import { verifyWebhookSignature } from "../src/webhooks.js";
import { NameEnquiryApi } from "../src/reference.js";

const collectionFixture = {
  response_code: "09",
  response_message: "PENDING",
  transaction_reference: "UDH012345",
  redirect_customer_to_url_processing: false,
};

describe("payaza webhook and status mapping", () => {
  it("accepts an HMAC-SHA512 signature of the raw body and rejects a mutated body", () => {
    const secret = "test-secret-not-base64";
    const raw = Buffer.from(JSON.stringify(collectionFixture));
    const header = createHmac("sha512", secret).update(raw).digest("base64");
    expect(verifyWebhookSignature(raw, header, secret)).toBe(true);
    expect(verifyWebhookSignature(Buffer.from(raw.toString() + " "), header, secret)).toBe(false);
    expect(verifyWebhookSignature(raw, undefined, secret)).toBe(false);
  });

  it("maps documented collection and payout statuses without treating pending as paid", () => {
    expect(collectionOutcome("09")).toBe("PENDING");
    expect(collectionOutcome("00")).toBe("SUCCESS");
    expect(collectionOutcome("06")).toBe("FAILED");
    expect(collectionOutcome("96")).toBe("FAILED");
    expect(payoutStatusGroup("NIP_SUCCESS")).toBe("SUCCEEDED");
    expect(payoutStatusGroup("NIP_FAILURE")).toBe("FAILED");
    expect(payoutStatusGroup("ESCROW_SUCCESS")).toBe("IN_FLIGHT");
    expect(payoutStatusGroup("NIP_PENDING")).toBe("IN_FLIGHT");
    expect(payoutStatusGroup("TRANSACTION_INITIATED")).toBe("IN_FLIGHT");
  });

  it("does not retry a money-moving POST", async () => {
    let calls = 0;
    const http = new PayazaHttp({
      baseUrl: "https://api.payaza.africa/live/",
      publicKey: "public-key",
      tenant: "test",
      fetchImpl: async () => {
        calls += 1;
        throw new Error("socket hang up");
      },
    });
    await expect(
      http.request({
        method: "POST",
        path: "payout-receptor/payout",
        body: { transaction_type: "mobile_money" },
        retry: "never",
        ambiguousReference: "VKP-TEST",
      }),
    ).rejects.toMatchObject({ code: "PAYAZA_AMBIGUOUS", transactionReference: "VKP-TEST" });
    expect(calls).toBe(1);
  });

  it("retries a GET on 503 and then returns the body", async () => {
    let calls = 0;
    const http = new PayazaHttp({
      baseUrl: "https://api.payaza.africa/live/",
      publicKey: "public-key",
      tenant: "test",
      fetchImpl: async () => {
        calls += 1;
        if (calls < 2) return new Response("{}", { status: 503 });
        return new Response(JSON.stringify({ status: true, data: [] }), { status: 200 });
      },
    });
    const result = await http.request<{ status: boolean }>({
      method: "GET",
      path: "payaza-account/api/v1/mainaccounts/merchant/enquiry/main",
      retry: "safe",
    });
    expect(result.data.status).toBe(true);
    expect(calls).toBe(2);
  });

  it("refuses name enquiry for KES before any HTTP call", async () => {
    const http = new PayazaHttp({
      baseUrl: "https://api.payaza.africa/live/",
      publicKey: "public-key",
      tenant: "test",
      fetchImpl: async () => {
        throw new Error("should not be called");
      },
    });
    const api = new NameEnquiryApi(http);
    await expect(api.enquire({ currency: "KES", bank_code: "SAFKEN", account_number: "254712345678" })).rejects.toBeInstanceOf(
      PayazaError,
    );
  });

  it("sends Authorization as Payaza base64, not Bearer", async () => {
    let authorization = "";
    const http = new PayazaHttp({
      baseUrl: "https://api.payaza.africa/live/",
      publicKey: "abc",
      tenant: "test",
      fetchImpl: async (_url, init) => {
        authorization = new Headers(init?.headers).get("authorization") ?? "";
        return new Response(JSON.stringify(collectionFixture), { status: 200 });
      },
    });
    await http.request({
      method: "POST",
      path: "subsidiary/collections/v1/process-collection",
      body: collectionFixture,
      productId: true,
      retry: "never",
    });
    expect(authorization.startsWith("Payaza ")).toBe(true);
    expect(authorization).not.toContain("Bearer");
    expect(authorization).toBe(`Payaza ${Buffer.from("abc").toString("base64")}`);
  });
});
