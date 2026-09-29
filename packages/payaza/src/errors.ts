export class PayazaError extends Error {
  readonly httpStatus: number;
  readonly payazaMessage: string;
  readonly body: unknown;
  readonly code: string;

  constructor(input: { httpStatus: number; message: string; body: unknown; code?: string }) {
    super(input.message);
    this.name = "PayazaError";
    this.httpStatus = input.httpStatus;
    this.payazaMessage = input.message;
    this.body = input.body;
    this.code = input.code ?? mapMessage(input.message, input.httpStatus);
  }
}

export class PayazaAmbiguousError extends PayazaError {
  readonly transactionReference: string;
  constructor(transactionReference: string, cause: unknown) {
    super({
      httpStatus: 0,
      message: "Payaza did not confirm the money-moving call. Query status with the same reference. Do not retry the POST.",
      body: { cause: cause instanceof Error ? cause.message : "unknown" },
      code: "PAYAZA_AMBIGUOUS",
    });
    this.name = "PayazaAmbiguousError";
    this.transactionReference = transactionReference;
  }
}

function mapMessage(message: string, httpStatus: number): string {
  const text = message.toLowerCase();
  if (text.includes("authentication failed") || httpStatus === 401) return "PAYAZA_UNAUTHENTICATED";
  if (text.includes("insufficient balance")) return "PAYAZA_INSUFFICIENT_BALANCE";
  if (text.includes("invalid transaction pin")) return "PAYAZA_INVALID_PIN";
  if (text.includes("transaction reference already exists")) return "PAYAZA_DUPLICATE_REFERENCE";
  if (text.includes("bank code")) return "PAYAZA_BANK_CODE";
  if (text.includes("account number")) return "PAYAZA_ACCOUNT_NUMBER";
  if (text.includes("transaction not found")) return "PAYAZA_NOT_FOUND";
  if (httpStatus >= 500) return "PAYAZA_UNAVAILABLE";
  return "PAYAZA_REJECTED";
}

export function messageFromBody(body: unknown): string {
  if (!body || typeof body !== "object") return "Payaza request failed";
  const record = body as Record<string, unknown>;
  const candidates = [record.response_message, record.message, record.debugMessage];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return "Payaza request failed";
}
