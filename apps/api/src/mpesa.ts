import { DomainError } from "@vukapay/core";

export interface MpesaConfig {
  consumerKey: string;
  consumerSecret: string;
  shortcode: string;
  passkey: string;
  baseUrl: string;
  callbackUrl: string;
}

export interface StkPushResult {
  checkoutRequestId: string;
  merchantRequestId: string;
  customerMessage?: string;
}

export interface StkQueryResult {
  pending: boolean;
  resultCode?: string;
  amount?: number;
  receipt?: string;
}

interface TokenCache {
  value: string;
  expiresAt: number;
}

export function mpesaFromEnv(env: NodeJS.ProcessEnv, publicAppUrl: string): MpesaConfig | null {
  const consumerKey = env.MPESA_CONSUMER_KEY?.trim();
  const consumerSecret = env.MPESA_CONSUMER_SECRET?.trim();
  const shortcode = env.MPESA_SHORTCODE?.trim();
  const passkey = env.MPESA_PASSKEY?.trim();
  if (!consumerKey || !consumerSecret || !shortcode || !passkey) return null;
  const baseUrl = (env.MPESA_BASE_URL?.trim() || "https://sandbox.safaricom.co.ke").replace(/\/$/, "");
  const host = (env.RENDER_EXTERNAL_URL || publicAppUrl).replace(/\/$/, "");
  const callbackUrl = env.MPESA_CALLBACK_URL?.trim() || `${host}/api/webhooks/mpesa/stk`;
  return { consumerKey, consumerSecret, shortcode, passkey, baseUrl, callbackUrl };
}

export function stkTimestamp(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}${pick("month")}${pick("day")}${pick("hour")}${pick("minute")}${pick("second")}`;
}

export function stkPassword(shortcode: string, passkey: string, timestamp: string): string {
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");
}

export function readStkCallback(body: unknown): { checkoutRequestId: string; resultCode: number; amount?: number; receipt?: string } | null {
  if (!body || typeof body !== "object") return null;
  const root = body as { Body?: { stkCallback?: Record<string, unknown> } };
  const callback = root.Body?.stkCallback;
  if (!callback || typeof callback.CheckoutRequestID !== "string") return null;
  const resultCode = Number(callback.ResultCode);
  if (!Number.isFinite(resultCode)) return null;
  const items = (callback.CallbackMetadata as { Item?: { Name?: string; Value?: unknown }[] } | undefined)?.Item ?? [];
  const amountItem = items.find((item) => item.Name === "Amount");
  const receiptItem = items.find((item) => item.Name === "MpesaReceiptNumber");
  const amount = typeof amountItem?.Value === "number" ? amountItem.Value : undefined;
  const receipt = typeof receiptItem?.Value === "string" ? receiptItem.Value : undefined;
  return { checkoutRequestId: callback.CheckoutRequestID, resultCode, amount, receipt };
}

export class MpesaStk {
  private tokenCache: TokenCache | null = null;

  constructor(private readonly config: MpesaConfig, private readonly fetchImpl: typeof fetch = fetch) {}

  async push(input: { phone: string; amount: number; accountReference: string; description: string }): Promise<StkPushResult> {
    const whole = Math.round(input.amount);
    if (!Number.isFinite(whole) || whole < 1) {
      throw new DomainError("VALIDATION_FAILED", "M-Pesa amount must be at least 1 shilling", 422);
    }
    const timestamp = stkTimestamp();
    const token = await this.accessToken();
    const response = await this.fetchImpl(`${this.config.baseUrl}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        BusinessShortCode: this.config.shortcode,
        Password: stkPassword(this.config.shortcode, this.config.passkey, timestamp),
        Timestamp: timestamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: whole,
        PartyA: input.phone,
        PartyB: this.config.shortcode,
        PhoneNumber: input.phone,
        CallBackURL: this.config.callbackUrl,
        AccountReference: input.accountReference.slice(0, 12),
        TransactionDesc: input.description.slice(0, 13),
      }),
    });
    const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok || !data || String(data.ResponseCode ?? "") !== "0" || typeof data.CheckoutRequestID !== "string") {
      const message = typeof data?.errorMessage === "string" ? data.errorMessage : typeof data?.ResponseDescription === "string" ? data.ResponseDescription : "Safaricom did not accept the STK push";
      throw new DomainError("PAYMENT_PROMPT_FAILED", message, 502);
    }
    return {
      checkoutRequestId: data.CheckoutRequestID,
      merchantRequestId: typeof data.MerchantRequestID === "string" ? data.MerchantRequestID : "",
      customerMessage: typeof data.CustomerMessage === "string" ? data.CustomerMessage : undefined,
    };
  }

  async query(checkoutRequestId: string): Promise<StkQueryResult> {
    const timestamp = stkTimestamp();
    const token = await this.accessToken();
    const response = await this.fetchImpl(`${this.config.baseUrl}/mpesa/stkpushquery/v1/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        BusinessShortCode: this.config.shortcode,
        Password: stkPassword(this.config.shortcode, this.config.passkey, timestamp),
        Timestamp: timestamp,
        CheckoutRequestID: checkoutRequestId,
      }),
    });
    const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!data) return { pending: true };
    const message = `${typeof data.errorMessage === "string" ? data.errorMessage : ""} ${typeof data.ResponseDescription === "string" ? data.ResponseDescription : ""}`;
    if (data.errorCode === "500.001.1001" || /being processed/i.test(message)) return { pending: true };
    if (data.ResultCode === undefined || data.ResultCode === null || data.ResultCode === "") return { pending: true };
    return { pending: false, resultCode: String(data.ResultCode) };
  }

  private async accessToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 30_000) return this.tokenCache.value;
    const basic = Buffer.from(`${this.config.consumerKey}:${this.config.consumerSecret}`).toString("base64");
    const response = await this.fetchImpl(`${this.config.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${basic}` },
    });
    const data = (await response.json().catch(() => null)) as { access_token?: string; expires_in?: string } | null;
    if (!response.ok || !data?.access_token) {
      throw new DomainError("PAYAZA_UNAVAILABLE", "Safaricom did not issue an access token", 502);
    }
    const seconds = Number(data.expires_in ?? "3599");
    this.tokenCache = { value: data.access_token, expiresAt: Date.now() + (Number.isFinite(seconds) ? seconds : 3599) * 1000 };
    return data.access_token;
  }
}
