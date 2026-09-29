import { createHash } from "node:crypto";
import { messageFromBody, PayazaAmbiguousError, PayazaError } from "./errors.js";

export type Tenant = "test" | "live";
export type RetryPolicy = "safe" | "never";

export interface PayazaHttpOptions {
  baseUrl: string;
  publicKey: string;
  tenant: Tenant;
  secretKey?: string;
  signPayouts?: boolean;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  log?: (event: Record<string, unknown>) => void;
}

export interface PayazaRequest {
  method: "GET" | "POST";
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  productId?: boolean;
  retry: RetryPolicy;
  /** When set, a network failure or non-JSON 5xx becomes PayazaAmbiguousError instead of a retry. */
  ambiguousReference?: string;
}

const RETRY_STATUS = new Set([500, 502, 503, 504]);

export class PayazaHttp {
  private readonly baseUrl: string;
  private readonly encodedKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: PayazaHttpOptions) {
    this.baseUrl = options.baseUrl.endsWith("/") ? options.baseUrl : `${options.baseUrl}/`;
    this.encodedKey = Buffer.from(options.publicKey, "utf8").toString("base64");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async request<T>(input: PayazaRequest): Promise<{ status: number; data: T; raw: string }> {
    const attempts = input.retry === "safe" ? 3 : 1;
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await this.once<T>(input);
      } catch (error) {
        lastError = error;
        const retryable = input.retry === "safe" && isRetryable(error);
        if (!retryable || attempt === attempts) break;
        await delay(200 * 2 ** (attempt - 1));
      }
    }
    if (input.retry === "never" && input.ambiguousReference && isAmbiguous(lastError)) {
      throw new PayazaAmbiguousError(input.ambiguousReference, lastError);
    }
    throw lastError;
  }

  private async once<T>(input: PayazaRequest): Promise<{ status: number; data: T; raw: string }> {
    const url = new URL(input.path.replace(/^\//, ""), this.baseUrl);
    for (const [key, value] of Object.entries(input.query ?? {})) url.searchParams.set(key, value);
    const bodyText = input.body === undefined ? undefined : JSON.stringify(input.body);
    const headers: Record<string, string> = {
      Authorization: `Payaza ${this.encodedKey}`,
      "X-TenantID": this.options.tenant,
      Accept: "application/json",
    };
    if (bodyText) headers["Content-Type"] = "application/json";
    if (input.productId) headers["X-ProductID"] = "app";
    if (input.path.includes("payout-receptor/payout") && this.options.signPayouts) {
      if (!this.options.secretKey || !bodyText) {
        throw new PayazaError({
          httpStatus: 0,
          message: "Signed payouts require PAYAZA_SECRET_KEY and an exact JSON body",
          body: null,
          code: "PAYAZA_SIGNATURE_UNAVAILABLE",
        });
      }
      const { signBody } = await import("./webhooks.js");
      headers["X-Payaza-Signature"] = signBody(bodyText, this.options.secretKey);
    }
    const started = Date.now();
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: input.method,
        headers,
        body: bodyText,
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
      });
    } catch (error) {
      this.options.log?.({
        msg: "payaza_network_error",
        method: input.method,
        path: input.path,
        ambiguous: Boolean(input.ambiguousReference),
      });
      throw error;
    }
    const raw = await response.text();
    this.options.log?.({
      msg: "payaza_response",
      method: input.method,
      path: input.path,
      status: response.status,
      ms: Date.now() - started,
      body_sha256: raw ? sha(raw) : undefined,
    });
    let data: unknown = null;
    if (raw.length > 0) {
      try {
        data = JSON.parse(raw);
      } catch {
        throw new PayazaError({
          httpStatus: response.status,
          message: "Payaza returned a non-JSON body",
          body: raw.slice(0, 200),
          code: "PAYAZA_UNAVAILABLE",
        });
      }
    }
    if (!response.ok) {
      throw new PayazaError({
        httpStatus: response.status,
        message: messageFromBody(data),
        body: data,
      });
    }
    return { status: response.status, data: data as T, raw };
  }
}

function isRetryable(error: unknown): boolean {
  if (error instanceof PayazaError) return RETRY_STATUS.has(error.httpStatus);
  return true;
}

function isAmbiguous(error: unknown): boolean {
  if (error instanceof PayazaError) return error.httpStatus === 0 || error.httpStatus >= 500;
  return true;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
