import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { ulid } from "ulid";

export function newId(prefix: string): string {
  return `${prefix}_${ulid()}`;
}

export function newUlid(): string {
  return ulid();
}

/** Collection reference. Corridor codes are compact (KEUG, KETZ) so the value stays a single token family. */
export function collectionReference(corridorCode: string): string {
  return `VK-${corridorCode}-${ulid()}`;
}

/** Payout reference. Payaza requires a minimum length of 10. */
export function payoutReference(): string {
  const ref = `VKP-${ulid()}`;
  if (ref.length < 10) {
    throw new Error("payout reference shorter than Payaza minimum");
  }
  return ref;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return Object.fromEntries(entries.map(([k, v]) => [k, sortValue(v)]));
  }
  return value;
}

export function payloadHash(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function randomToken(bytes = 32): string {
  const raw = randomBytes(bytes);
  let out = "";
  for (const byte of raw) out += CROCKFORD[byte % 32];
  return out;
}

export function sha256Buffer(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function timingSafeStringEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** 6-digit numeric code for delivery confirmation. Returned once to the notifier; only the hash is stored. */
export function deliveryCode(): { code: string; hash: string } {
  const n = randomBytes(4).readUInt32BE(0) % 1_000_000;
  const code = n.toString().padStart(6, "0");
  return { code, hash: sha256Hex(`delivery:${code}`) };
}

export function deliveryCodeMatches(code: string, hash: string): boolean {
  return timingSafeStringEqual(sha256Hex(`delivery:${code}`), hash);
}
