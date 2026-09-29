import { extendZodWithOpenApi, OpenApiGeneratorV31, OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

extendZodWithOpenApi(z);

export const Money = z
  .object({
    amount_minor: z.string().regex(/^-?\d+$/),
    currency: z.enum(["KES", "UGX", "TZS", "USD"]),
  })
  .openapi("Money");

export const ErrorBody = z
  .object({
    error: z.object({
      code: z.enum([
        "VALIDATION_FAILED",
        "UNAUTHENTICATED",
        "FORBIDDEN",
        "NOT_FOUND",
        "CONFLICT",
        "QUOTE_EXPIRED",
        "FX_SETTLEMENT_UNAVAILABLE",
        "FX_RATE_UNAVAILABLE",
        "PAYMENT_PROMPT_FAILED",
        "INVALID_PHONE_FORMAT",
        "LIMIT_EXCEEDED",
        "KYC_REQUIRED",
        "RECIPIENT_NOT_VERIFIED",
        "CAPABILITY_GATED",
        "ILLEGAL_STATE_TRANSITION",
        "PAYAZA_UNAVAILABLE",
        "DEPENDENCY_UNAVAILABLE",
      ]),
      message: z.string(),
      details: z.record(z.unknown()).optional(),
      request_id: z.string(),
    }),
  })
  .openapi("Error");

const Capability = z.object({
  key: z.string(),
  status: z.enum(["LIVE", "SANDBOX", "GATED"]),
  reason: z.string().optional(),
});

export const registry = new OpenAPIRegistry();

function json(schema: z.ZodTypeAny) {
  return { description: "OK", content: { "application/json": { schema } } };
}

const paths: { method: "get" | "post" | "patch" | "put" | "delete"; path: string; summary: string }[] = [
  { method: "get", path: "/health", summary: "Process health" },
  { method: "get", path: "/openapi.json", summary: "This document" },
  { method: "get", path: "/v1/system/capabilities", summary: "Capability status" },
  { method: "get", path: "/v1/system/funds-holding", summary: "Funds-holding statement" },
  { method: "get", path: "/v1/meta/corridors", summary: "Enabled corridors" },
  { method: "get", path: "/v1/meta/currencies", summary: "Currency exponents" },
  { method: "post", path: "/v1/auth/register", summary: "Register exporter" },
  { method: "post", path: "/v1/auth/login", summary: "Login" },
  { method: "post", path: "/v1/auth/refresh", summary: "Refresh access token" },
  { method: "post", path: "/v1/auth/logout", summary: "Revoke refresh token" },
  { method: "get", path: "/v1/me", summary: "Current profile" },
  { method: "patch", path: "/v1/me", summary: "Update profile" },
  { method: "put", path: "/v1/me/business", summary: "Update business" },
  { method: "post", path: "/v1/me/kyc/documents", summary: "Upload KYC document" },
  { method: "get", path: "/v1/me/kyc", summary: "KYC status" },
  { method: "post", path: "/v1/payout-methods", summary: "Add M-Pesa payout number" },
  { method: "post", path: "/v1/payout-methods/{id}/otp/send", summary: "Send payout OTP" },
  { method: "post", path: "/v1/payout-methods/{id}/otp/verify", summary: "Verify payout OTP" },
  { method: "get", path: "/v1/payout-methods", summary: "List payout methods" },
  { method: "delete", path: "/v1/payout-methods/{id}", summary: "Start cooling-off removal" },
  { method: "post", path: "/v1/invoices", summary: "Create invoice and preview quote" },
  { method: "get", path: "/v1/invoices", summary: "List invoices" },
  { method: "get", path: "/v1/invoices/{id}", summary: "Get invoice" },
  { method: "post", path: "/v1/invoices/{id}/send", summary: "Send invoice and create trade" },
  { method: "post", path: "/v1/invoices/{id}/cancel", summary: "Cancel invoice" },
  { method: "get", path: "/v1/trades", summary: "List trades" },
  { method: "get", path: "/v1/trades/{id}", summary: "Trade timeline" },
  { method: "get", path: "/v1/trades/{id}/stream", summary: "Trade SSE" },
  { method: "post", path: "/v1/trades/{id}/ship", summary: "Declare dispatch" },
  { method: "post", path: "/v1/trades/{id}/delivery-claim", summary: "Claim delivery" },
  { method: "post", path: "/v1/trades/{id}/evidence", summary: "Upload evidence" },
  { method: "get", path: "/v1/balance", summary: "Exporter balance view" },
  { method: "get", path: "/v1/payouts", summary: "List payouts" },
  { method: "get", path: "/v1/payouts/{id}", summary: "Get payout" },
  { method: "get", path: "/v1/pay/{token}", summary: "Buyer invoice view" },
  { method: "post", path: "/v1/pay/{token}/quote/refresh", summary: "Refresh expired quote" },
  { method: "post", path: "/v1/pay/{token}/collect", summary: "Start mobile-money collection" },
  { method: "get", path: "/v1/pay/{token}/status", summary: "Buyer status" },
  { method: "get", path: "/v1/pay/{token}/stream", summary: "Buyer SSE" },
  { method: "post", path: "/v1/pay/{token}/retry", summary: "Retry collection with a new reference" },
  { method: "post", path: "/v1/pay/{token}/confirm-delivery", summary: "Confirm delivery code" },
  { method: "post", path: "/v1/pay/{token}/dispute", summary: "Open a dispute" },
  { method: "post", path: "/v1/partnerships", summary: "Create partnership" },
  { method: "get", path: "/v1/partnerships", summary: "List partnerships" },
  { method: "get", path: "/v1/partnerships/{id}", summary: "Get partnership" },
  { method: "patch", path: "/v1/partnerships/{id}", summary: "Update partnership" },
  { method: "post", path: "/v1/partnerships/{id}/invoices", summary: "Invoice from partnership" },
  { method: "get", path: "/v1/records", summary: "Trade records" },
  { method: "get", path: "/v1/credit/score", summary: "Trade-record summary" },
  { method: "post", path: "/v1/credit/consents", summary: "Grant lender access" },
  { method: "delete", path: "/v1/credit/consents/{id}", summary: "Revoke consent" },
  { method: "get", path: "/v1/credit/consents", summary: "List consents" },
  { method: "get", path: "/v1/records/export", summary: "Export records" },
  { method: "get", path: "/v1/admin/trades", summary: "Admin trade list" },
  { method: "get", path: "/v1/admin/disputes", summary: "Admin disputes" },
  { method: "post", path: "/v1/admin/disputes/{id}/resolve", summary: "Resolve dispute" },
  { method: "post", path: "/v1/admin/payouts/{id}/recheck", summary: "Recheck Payaza payout status" },
  { method: "post", path: "/v1/admin/payouts/{id}/retry", summary: "Retry a confirmed-failed payout" },
  { method: "get", path: "/v1/admin/reconciliation", summary: "Ledger versus Payaza balances" },
  { method: "get", path: "/v1/admin/payaza-events", summary: "Webhook inbox" },
  { method: "post", path: "/v1/admin/payaza-events/{id}/replay", summary: "Replay a stored webhook" },
  { method: "get", path: "/v1/admin/feature-flags", summary: "Feature flags" },
  { method: "put", path: "/v1/admin/feature-flags", summary: "Update a feature flag" },
  { method: "get", path: "/v1/admin/treasury/conversions", summary: "Recorded conversions" },
  { method: "post", path: "/v1/admin/treasury/conversions", summary: "Record a real conversion" },
  { method: "get", path: "/v1/admin/treasury/exposure", summary: "Open FX exposure" },
  { method: "get", path: "/v1/admin/health/payaza", summary: "Payaza account health" },
  { method: "post", path: "/v1/admin/sandbox/fund-collection", summary: "Test-tenant collection funding" },
  { method: "post", path: "/api/webhooks/payaza", summary: "Payaza webhook receiver" },
];

for (const route of paths) {
  registry.registerPath({
    method: route.method,
    path: route.path,
    summary: route.summary,
    responses: {
      200: json(route.path === "/v1/system/capabilities" ? z.object({ tenant: z.enum(["test", "live"]), capabilities: z.array(Capability) }) : z.object({}).passthrough()),
      400: json(ErrorBody),
    },
  });
}

export function openApiDocument() {
  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: "3.1.0",
    info: {
      title: "VukaPay API",
      version: "0.1.0",
      description:
        "Frontend contract for VukaPay. Money is integer minor units in strings. Mutating calls require Idempotency-Key. Payaza webhooks are not browser calls.",
    },
    servers: [{ url: "/" }],
  });
}

export const API_PATHS = paths.map((route) => `${route.method.toUpperCase()} ${route.path}`);
export { z };
