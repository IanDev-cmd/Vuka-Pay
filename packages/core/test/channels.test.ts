import { describe, expect, it } from "vitest";
import {
  DOCUMENTED_COLLECTION_NETWORKS,
  assertCollectionNetwork,
  corridorForBuyerCurrency,
  escrowFingerprint,
  exponentOf,
  issueNfcToken,
  normalizePhone,
  paymentQrText,
  readNfcToken,
} from "../src/index.js";

describe("EAC corridors", () => {
  it("collects RWF on the Kenya–Rwanda corridor with a zero exponent", () => {
    const corridor = corridorForBuyerCurrency("RWF");
    expect(corridor.id).toBe("KE-RW");
    expect(corridor.buyerCountry).toBe("RW");
    expect(exponentOf("RWF")).toBe(0);
    expect(exponentOf("KES")).toBe(2);
    expect(normalizePhone("0788123456", "RW")).toBe("250788123456");
  });

  it("still rejects collection codes that are not in a Payaza sample", () => {
    expect(() => assertCollectionNetwork([...DOCUMENTED_COLLECTION_NETWORKS], "UGX", "MTNUG")).toThrow(
      /not in the verified Payaza code list/,
    );
    expect(() => assertCollectionNetwork([...DOCUMENTED_COLLECTION_NETWORKS], "RWF", "MTNRW")).toThrow(
      /not in the verified Payaza code list/,
    );
  });
});

describe("payment QR and NFC", () => {
  it("embeds the trade fields and only a checkout URL that was supplied", () => {
    const text = paymentQrText({
      invoiceId: "inv_1",
      tradeId: "trd_1",
      payToken: "pay",
      corridor: "KE-UG",
      settlementCurrency: "KES",
      amount: "1328850",
      payazaCheckoutUrl: null,
    });
    const parsed = JSON.parse(text) as { payazaCheckoutUrl: string | null; tradeId: string };
    expect(parsed.tradeId).toBe("trd_1");
    expect(parsed.payazaCheckoutUrl).toBeNull();
  });

  it("round-trips an NFC delivery token and rejects a swapped trade", () => {
    const secret = "dev-only-secret-change-me-please-32";
    const now = new Date("2026-09-29T04:00:00.000Z");
    const token = issueNfcToken(secret, {
      tradeId: "trd_1",
      escrowHash: escrowFingerprint("trd_1", "4500000"),
      issuedAt: now.toISOString(),
    });
    expect(readNfcToken(secret, token, now).tradeId).toBe("trd_1");
    const [body, sig] = token.split(".");
    const flipped = `${body}.${sig.slice(0, -1)}${sig.endsWith("a") ? "b" : "a"}`;
    expect(() => readNfcToken(secret, flipped, now)).toThrow(/signature/);
  });
});
