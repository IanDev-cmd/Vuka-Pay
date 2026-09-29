import { createHmac, timingSafeEqual } from "node:crypto";
import { DomainError } from "./errors.js";

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function escrowFingerprint(tradeId: string, itemsMinor: string): string {
  return createHmac("sha256", "vukapay-escrow").update(`${tradeId}|${itemsMinor}`).digest("hex");
}

export function issueNfcToken(
  secret: string,
  input: { tradeId: string; escrowHash: string; issuedAt: string },
): string {
  const body = Buffer.from(
    JSON.stringify({
      tradeId: input.tradeId,
      escrowHash: input.escrowHash,
      issuedAt: input.issuedAt,
    }),
  ).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function readNfcToken(
  secret: string,
  token: string,
  now: Date,
): { tradeId: string; escrowHash: string; issuedAt: string } {
  const split = token.split(".");
  if (split.length !== 2) {
    throw new DomainError("VALIDATION_FAILED", "NFC token is malformed", 422);
  }
  const [body, sig] = split;
  if (!body || !sig) {
    throw new DomainError("VALIDATION_FAILED", "NFC token is malformed", 422);
  }
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new DomainError("VALIDATION_FAILED", "NFC token signature does not match", 422);
  }
  let parsed: { tradeId?: unknown; escrowHash?: unknown; issuedAt?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as typeof parsed;
  } catch {
    throw new DomainError("VALIDATION_FAILED", "NFC token payload is not readable", 422);
  }
  if (typeof parsed.tradeId !== "string" || typeof parsed.escrowHash !== "string" || typeof parsed.issuedAt !== "string") {
    throw new DomainError("VALIDATION_FAILED", "NFC token payload is incomplete", 422);
  }
  const issued = Date.parse(parsed.issuedAt);
  if (!Number.isFinite(issued) || now.getTime() - issued > MAX_AGE_MS || issued - now.getTime() > 5 * 60 * 1000) {
    throw new DomainError("VALIDATION_FAILED", "NFC token is outside its validity window", 422);
  }
  return { tradeId: parsed.tradeId, escrowHash: parsed.escrowHash, issuedAt: parsed.issuedAt };
}
