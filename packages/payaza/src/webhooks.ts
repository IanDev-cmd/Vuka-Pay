import { createHmac, timingSafeEqual } from "node:crypto";

/** base64(HMAC-SHA512(raw body, secret key)). Secret is not base64-encoded. */
export function signBody(raw: Buffer | string, secret: string): string {
  return createHmac("sha512", secret).update(raw).digest("base64");
}

export function verifyWebhookSignature(raw: Buffer, header: string | undefined, secret: string): boolean {
  if (!header || !secret) return false;
  const computed = signBody(raw, secret);
  const left = Buffer.from(computed);
  const right = Buffer.from(header.trim());
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
