import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 32)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hex] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hex) return false;
  const derived = (await scrypt(password, salt, 32)) as Buffer;
  const left = Buffer.from(hex, "hex");
  if (left.length !== derived.length) return false;
  return timingSafeEqual(left, derived);
}

export function signJwt(payload: Record<string, unknown>, secret: string, ttlSeconds: number): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(
    JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds }),
  ).toString("base64url");
  const data = `${header}.${body}`;
  const signature = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${signature}`;
}

export function verifyJwt(token: string, secret: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed");
  const [header, body, signature] = parts;
  if (!header || !body || !signature) throw new Error("malformed");
  const data = `${header}.${body}`;
  const expected = createHmac("sha256", secret).update(data).digest("base64url");
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) throw new Error("bad signature");
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, unknown>;
  if (typeof payload.exp === "number" && payload.exp < Math.floor(Date.now() / 1000)) throw new Error("expired");
  return payload;
}

export function signTradeToken(tradeId: string, secret: string, ttlSeconds: number): { token: string; expiresAt: Date } {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = Buffer.from(JSON.stringify({ tid: tradeId, exp })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return { token: `${payload}.${signature}`, expiresAt: new Date(exp * 1000) };
}

export function readTradeToken(token: string, secret: string): { tradeId: string; expiresAt: Date } {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) throw new Error("malformed");
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) throw new Error("bad signature");
  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { tid?: string; exp?: number };
  if (!parsed.tid || !parsed.exp) throw new Error("malformed");
  if (parsed.exp < Math.floor(Date.now() / 1000)) throw new Error("expired");
  return { tradeId: parsed.tid, expiresAt: new Date(parsed.exp * 1000) };
}
