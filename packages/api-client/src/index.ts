export interface ClientOptions {
  baseUrl: string;
  accessToken?: string;
  language?: "en" | "sw";
}

export class VukaPayClient {
  constructor(private readonly options: ClientOptions) {}

  capabilities() {
    return this.request("GET", "/v1/system/capabilities");
  }
  fundsHolding() {
    return this.request("GET", "/v1/system/funds-holding");
  }
  corridors() {
    return this.request("GET", "/v1/meta/corridors");
  }
  currencies() {
    return this.request("GET", "/v1/meta/currencies");
  }
  register(body: { email: string; password: string; display_name: string }) {
    return this.request("POST", "/v1/auth/register", body);
  }
  login(body: { email: string; password: string }) {
    return this.request("POST", "/v1/auth/login", body);
  }
  me() {
    return this.request("GET", "/v1/me");
  }
  createInvoice(body: unknown, idempotencyKey: string) {
    return this.request("POST", "/v1/invoices", body, idempotencyKey);
  }
  sendInvoice(id: string, idempotencyKey: string) {
    return this.request("POST", `/v1/invoices/${id}/send`, {}, idempotencyKey);
  }
  buyerView(token: string) {
    return this.request("GET", `/v1/pay/${token}`);
  }
  collect(token: string, body: { phone: string; network_code: string }, idempotencyKey: string) {
    return this.request("POST", `/v1/pay/${token}/collect`, body, idempotencyKey);
  }
  buyerStatus(token: string) {
    return this.request("GET", `/v1/pay/${token}/status`);
  }

  private async request(method: string, path: string, body?: unknown, idempotencyKey?: string) {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.options.accessToken) headers.Authorization = `Bearer ${this.options.accessToken}`;
    if (this.options.language) headers["Accept-Language"] = this.options.language;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    const response = await fetch(new URL(path, this.options.baseUrl), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok) {
      const error = new Error(payload?.error?.message ?? response.statusText) as Error & { code?: string; status: number };
      error.code = payload?.error?.code;
      error.status = response.status;
      throw error;
    }
    return payload;
  }
}
