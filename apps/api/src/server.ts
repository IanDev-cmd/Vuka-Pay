import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { openApiDocument } from "@vukapay/contract";
import {
  DomainError,
  FUNDS_HOLDING,
  VukaService,
  canonicalJson,
  isDomainError,
  languageFromHeader,
  newId,
  sha256Hex,
  type Repository,
} from "@vukapay/core";
import { verifyWebhookSignature } from "@vukapay/payaza";
import { readStkCallback } from "./mpesa.js";
import { corridorCatalog, currencyCatalog, type AppConfig } from "./config.js";
import { loadObservations } from "./rates.js";

export interface ServerDeps {
  config: AppConfig;
  repo: Repository | null;
  service: VukaService | null;
}

export async function buildServer(deps: ServerDeps) {
  const app = Fastify({
    logger: process.env.VITEST
      ? false
      : {
          level: "info",
          redact: {
            paths: [
              "req.headers.authorization",
              "req.body.password",
              "req.body.transaction_pin",
              "req.body.code",
              "req.body.otp",
            ],
            censor: "[redacted]",
          },
        },
    genReqId: () => newId("req"),
  });
  await app.register(cors, { origin: true });

  app.setErrorHandler((error, request, reply) => {
    if (isDomainError(error)) {
      return reply.code(error.httpStatus).send({
        error: { code: error.code, message: error.message, details: error.details, request_id: request.id },
      });
    }
    request.log.error({ err: error }, "unhandled");
    return reply.code(500).send({
      error: { code: "PAYAZA_UNAVAILABLE", message: "Unexpected server error", request_id: request.id },
    });
  });

  app.get("/health", async () => ({
    status: deps.repo ? "ok" : "degraded",
    database: deps.repo ? "up" : "unconfigured",
  }));
  app.get("/openapi.json", async () => openApiDocument());
  app.get("/v1/system/funds-holding", async (request) => ({
    statement: FUNDS_HOLDING[languageFromHeader(request.headers["accept-language"])],
  }));
  app.get("/v1/meta/currencies", async () => ({ data: currencyCatalog() }));
  app.get("/v1/meta/corridors", async () => ({ data: corridorCatalog(deps.config.collectionNetworks) }));
  app.get("/v1/system/capabilities", async () => {
    if (!deps.service) return { tenant: deps.config.PAYAZA_TENANT, capabilities: [] };
    return deps.service.capabilities();
  });

  const svc = () => {
    if (!deps.service || !deps.repo) {
      throw new DomainError("DEPENDENCY_UNAVAILABLE", "DATABASE_URL is not configured", 503);
    }
    return deps.service;
  };
  const repo = () => {
    if (!deps.repo) throw new DomainError("DEPENDENCY_UNAVAILABLE", "DATABASE_URL is not configured", 503);
    return deps.repo;
  };

  const auth = (request: FastifyRequest) => svc().requireAccessToken(request.headers.authorization);

  async function idempotent(request: FastifyRequest, reply: FastifyReply, userScope: string, run: () => Promise<unknown>) {
    const key = request.headers["idempotency-key"];
    if (typeof key !== "string" || key.length < 8) {
      throw new DomainError("VALIDATION_FAILED", "Idempotency-Key header is required", 422);
    }
    const path = request.url.split("?")[0] ?? request.url;
    const hash = sha256Hex(canonicalJson(request.body ?? {}));
    const existing = await repo().idempotency(key, userScope, request.method, path);
    if (existing) {
      if (existing.requestHash !== hash) throw new DomainError("CONFLICT", "Idempotency-Key was reused with a different body", 409);
      return reply.code(existing.statusCode).send(existing.responseBody);
    }
    const body = await run();
    await repo().saveIdempotency({ key, userScope, method: request.method, path, requestHash: hash, statusCode: 200, responseBody: body });
    return body;
  }

  app.post("/v1/auth/register", async (request) => {
    const body = request.body as { email: string; password: string; display_name: string };
    return svc().register({
      email: body.email,
      password: body.password,
      displayName: body.display_name,
      language: languageFromHeader(request.headers["accept-language"]),
    });
  });
  app.post("/v1/auth/login", async (request) => svc().login(request.body as { email: string; password: string }));
  app.post("/v1/auth/refresh", async (request) => svc().refresh((request.body as { refresh_token: string }).refresh_token));
  app.post("/v1/auth/logout", async (request) => {
    await svc().logout((request.body as { refresh_token: string }).refresh_token);
    return { ok: true };
  });
  app.get("/v1/me", async (request) => svc().me(auth(request).sub));
  app.patch("/v1/me", async (request) => {
    const body = request.body as { display_name?: string; phone?: string; language?: "en" | "sw" };
    return svc().updateMe(auth(request).sub, { displayName: body.display_name, phone: body.phone, language: body.language });
  });
  app.put("/v1/me/business", async (request) => {
    const body = request.body as { legal_name: string; trading_name: string; national_id_number?: string; kra_pin?: string };
    return svc().updateBusiness(auth(request).sub, {
      legalName: body.legal_name,
      tradingName: body.trading_name,
      nationalIdNumber: body.national_id_number,
      kraPin: body.kra_pin,
    });
  });
  app.post("/v1/me/kyc/documents", async () => {
    throw new DomainError("CAPABILITY_GATED", "Object storage is not configured, so KYC files are not accepted", 409);
  });
  const photosBlocked = () => {
    throw new DomainError(
      "CAPABILITY_GATED",
      "Profile photos are blocked until image moderation is configured",
      409,
    );
  };
  app.post("/v1/me/avatar", photosBlocked);
  app.delete("/v1/me/avatar", photosBlocked);
  app.post("/v1/me/business/logo", photosBlocked);
  app.post("/v1/pay/:token/profile", photosBlocked);
  app.get("/v1/me/kyc", async (request) => {
    const user = auth(request);
    const business = await repo().businessByUser(user.sub);
    if (!business) throw new DomainError("NOT_FOUND", "Business missing", 404);
    return { kyc_tier: business.kycTier, documents: await repo().kyc(business.id) };
  });

  app.post("/v1/payout-methods", async (request, reply) =>
    idempotent(request, reply, auth(request).sub, () => {
      const body = request.body as { phone: string; account_name: string };
      return svc().addPayoutMethod(auth(request).sub, { phone: body.phone, accountName: body.account_name });
    }),
  );
  app.post("/v1/payout-methods/:id/otp/send", async (request, reply) =>
    idempotent(request, reply, auth(request).sub, () =>
      svc().sendPayoutOtp(auth(request).sub, (request.params as { id: string }).id, languageFromHeader(request.headers["accept-language"])),
    ),
  );
  app.post("/v1/payout-methods/:id/otp/verify", async (request, reply) =>
    idempotent(request, reply, auth(request).sub, () =>
      svc().verifyPayoutOtp(auth(request).sub, (request.params as { id: string }).id, (request.body as { code: string }).code),
    ),
  );
  app.get("/v1/payout-methods", async (request) => ({ data: await svc().listPayoutMethods(auth(request).sub) }));
  app.delete("/v1/payout-methods/:id", async (request) => svc().deletePayoutMethod(auth(request).sub, (request.params as { id: string }).id));

  app.post("/v1/invoices", async (request, reply) =>
    idempotent(request, reply, auth(request).sub, async () => {
      const body = request.body as {
        items: { description: string; quantity: number; unit_amount_minor: string }[];
        buyer: { name: string; phone: string; country: "KE" | "UG" | "TZ" | "RW"; network?: string; currency: "KES" | "UGX" | "TZS" | "RWF" };
        notes?: string;
        shipping_deadline?: string;
        dispute_window_hours?: number;
      };
      const observations = body.buyer.currency === "KES" ? [] : await loadObservations(body.buyer.currency);
      return svc().createInvoice(auth(request).sub, {
        items: body.items.map((item) => ({ description: item.description, quantity: item.quantity, unitMinor: BigInt(item.unit_amount_minor) })),
        buyer: body.buyer,
        notes: body.notes,
        shippingDeadline: body.shipping_deadline,
        disputeWindowHours: body.dispute_window_hours,
        observations,
      });
    }),
  );
  app.get("/v1/invoices", async (request) => ({ data: await svc().listInvoices(auth(request).sub), next_cursor: null }));
  app.get("/v1/invoices/:id", async (request) => svc().getInvoice(auth(request).sub, (request.params as { id: string }).id));
  app.post("/v1/invoices/:id/send", async (request, reply) =>
    idempotent(request, reply, auth(request).sub, () =>
      svc().sendInvoice(auth(request).sub, (request.params as { id: string }).id, languageFromHeader(request.headers["accept-language"])),
    ),
  );
  app.post("/v1/invoices/:id/cancel", async (request, reply) =>
    idempotent(request, reply, auth(request).sub, () => svc().cancelInvoice(auth(request).sub, (request.params as { id: string }).id)),
  );

  app.get("/v1/trades", async (request) => ({ data: await svc().listTrades(auth(request).sub), next_cursor: null }));
  app.get("/v1/trades/:id", async (request) => svc().getTrade(auth(request).sub, (request.params as { id: string }).id));
  app.get("/v1/trades/:id/stream", async (request, reply) => stream(reply, await svc().getTrade(auth(request).sub, (request.params as { id: string }).id)));
  app.post("/v1/trades/:id/ship", async (request, reply) =>
    idempotent(request, reply, auth(request).sub, () => {
      const body = request.body as { waybill_no?: string; carrier?: string };
      return svc().ship(auth(request).sub, (request.params as { id: string }).id, { waybillNo: body.waybill_no, carrier: body.carrier });
    }),
  );
  app.post("/v1/trades/:id/delivery-claim", async (request, reply) =>
    idempotent(request, reply, auth(request).sub, () => svc().deliveryClaim(auth(request).sub, (request.params as { id: string }).id)),
  );
  app.post("/v1/trades/:id/verify-nfc", async (request, reply) =>
    idempotent(request, reply, auth(request).sub, async () => {
      const tradeId = (request.params as { id: string }).id;
      await svc().getTrade(auth(request).sub, tradeId);
      return svc().verifyNfc(tradeId, (request.body as { token: string }).token);
    }),
  );
  app.post("/v1/trades/:id/evidence", async () => {
    throw new DomainError("CAPABILITY_GATED", "Object storage is not configured, so evidence files are not accepted", 409);
  });
  app.get("/v1/balance", async (request) => {
    const user = auth(request);
    const business = await repo().businessByUser(user.sub);
    if (!business) throw new DomainError("NOT_FOUND", "Business missing", 404);
    const trades = await repo().trades({ businessId: business.id });
    const hold = trades
      .filter((trade) => ["FUNDED", "SHIPPED", "DELIVERY_CLAIMED", "DISPUTED", "RELEASE_PENDING", "PAYOUT_FAILED"].includes(trade.state))
      .reduce((sum, trade) => sum + (trade.buyerCurrency === "KES" ? trade.heldBuyerMinor : trade.exporterNetMinor), 0n);
    const paid = trades.filter((trade) => trade.state === "PAID_OUT").reduce((sum, trade) => sum + trade.exporterNetMinor, 0n);
    const pending = trades.filter((trade) => trade.state === "RELEASE_PENDING").reduce((sum, trade) => sum + trade.exporterNetMinor, 0n);
    return {
      in_hold: [{ amount_minor: hold.toString(), currency: "KES" }],
      paid_out: [{ amount_minor: paid.toString(), currency: "KES" }],
      pending_payout: [{ amount_minor: pending.toString(), currency: "KES" }],
    };
  });
  app.get("/v1/payouts", async (request) => {
    const business = await repo().businessByUser(auth(request).sub);
    if (!business) throw new DomainError("NOT_FOUND", "Business missing", 404);
    const rows = await repo().payouts({ businessId: business.id });
    return { data: rows.map(publicPayout), next_cursor: null };
  });
  app.get("/v1/payouts/:id", async (request) => {
    const row = await repo().payout((request.params as { id: string }).id);
    if (!row) throw new DomainError("NOT_FOUND", "Payout not found", 404);
    return publicPayout(row);
  });

  app.get("/v1/pay/:token", async (request) => {
    const token = (request.params as { token: string }).token;
    await svc().openBuyer(token);
    return svc().buyerView(token);
  });
  app.post("/v1/pay/:token/quote/refresh", async (request, reply) =>
    idempotent(request, reply, "buyer", async () => {
      const token = (request.params as { token: string }).token;
      const view = await svc().buyerView(token);
      const currency = view.buyer_amount.currency;
      if (currency !== "KES" && currency !== "UGX" && currency !== "TZS" && currency !== "RWF") {
        throw new DomainError("VALIDATION_FAILED", "This pay link is not an EAC collection currency", 422);
      }
      return svc().refreshBuyerQuote(token, currency === "KES" ? [] : await loadObservations(currency));
    }),
  );
  app.post("/v1/pay/:token/collect", async (request, reply) =>
    idempotent(request, reply, "buyer", () => {
      const body = request.body as { phone: string; network_code: string };
      return svc().collect((request.params as { token: string }).token, { phone: body.phone, networkCode: body.network_code });
    }),
  );
  app.get("/v1/pay/:token/status", async (request) => {
    const token = (request.params as { token: string }).token;
    await svc().syncMpesa(token).catch(() => undefined);
    return svc().buyerView(token);
  });
  app.get("/v1/pay/:token/stream", async (request, reply) => stream(reply, await svc().buyerView((request.params as { token: string }).token)));
  app.post("/v1/pay/:token/retry", async (request, reply) =>
    idempotent(request, reply, "buyer", () => {
      const body = request.body as { phone: string; network_code: string };
      return svc().collect((request.params as { token: string }).token, { phone: body.phone, networkCode: body.network_code });
    }),
  );
  app.post("/v1/pay/:token/verify-nfc", async (request, reply) =>
    idempotent(request, reply, "buyer", () =>
      svc().verifyNfcForBuyer((request.params as { token: string }).token, (request.body as { token: string }).token),
    ),
  );
  app.post("/v1/pay/:token/confirm-delivery", async (request, reply) =>
    idempotent(request, reply, "buyer", () =>
      svc().confirmDelivery((request.params as { token: string }).token, (request.body as { code: string }).code),
    ),
  );
  app.post("/v1/pay/:token/dispute", async (request, reply) =>
    idempotent(request, reply, "buyer", () =>
      svc().dispute((request.params as { token: string }).token, (request.body as { reason: string }).reason),
    ),
  );

  app.post("/v1/partnerships", async (request, reply) =>
    idempotent(request, reply, auth(request).sub, async () => {
      const business = await repo().businessByUser(auth(request).sub);
      if (!business) throw new DomainError("NOT_FOUND", "Business missing", 404);
      const body = request.body as { partner_code: string; buyer_name: string; buyer_phone: string; buyer_country: "UG" | "TZ" | "RW"; currency: "UGX" | "TZS" | "RWF"; network_code?: string };
      const row = {
        id: newId("prt"),
        businessId: business.id,
        partnerCode: body.partner_code,
        buyerName: body.buyer_name,
        buyerPhone: body.buyer_phone,
        buyerCountry: body.buyer_country,
        networkCode: body.network_code ?? null,
        currency: body.currency,
      };
      await repo().savePartnership(row);
      return row;
    }),
  );
  app.get("/v1/partnerships", async (request) => {
    const business = await repo().businessByUser(auth(request).sub);
    if (!business) throw new DomainError("NOT_FOUND", "Business missing", 404);
    return { data: await repo().partnerships(business.id), next_cursor: null };
  });
  app.get("/v1/partnerships/:id", async (request) => {
    const row = await repo().partnership((request.params as { id: string }).id);
    if (!row) throw new DomainError("NOT_FOUND", "Partnership not found", 404);
    return row;
  });
  app.patch("/v1/partnerships/:id", async (request) => {
    const current = await repo().partnership((request.params as { id: string }).id);
    if (!current) throw new DomainError("NOT_FOUND", "Partnership not found", 404);
    const body = request.body as { buyer_name?: string; network_code?: string };
    const next = { ...current, buyerName: body.buyer_name ?? current.buyerName, networkCode: body.network_code ?? current.networkCode };
    await repo().savePartnership(next);
    return next;
  });
  app.post("/v1/partnerships/:id/invoices", async (request, reply) =>
    idempotent(request, reply, auth(request).sub, async () => {
      const partnership = await repo().partnership((request.params as { id: string }).id);
      if (!partnership) throw new DomainError("NOT_FOUND", "Partnership not found", 404);
      const body = request.body as { items: { description: string; quantity: number; unit_amount_minor: string }[]; notes?: string };
      const currency = partnership.currency === "TZS" ? "TZS" : "UGX";
      return svc().createInvoice(auth(request).sub, {
        items: body.items.map((item) => ({ description: item.description, quantity: item.quantity, unitMinor: BigInt(item.unit_amount_minor) })),
        buyer: {
          name: partnership.buyerName,
          phone: partnership.buyerPhone,
          country: partnership.buyerCountry === "TZ" ? "TZ" : "UG",
          currency,
          network: partnership.networkCode ?? undefined,
        },
        notes: body.notes,
        observations: await loadObservations(currency),
        partnershipId: partnership.id,
      });
    }),
  );

  app.get("/v1/records", async (request) => {
    if (!deps.config.CREDIT_ENABLED) throw new DomainError("CAPABILITY_GATED", "Trade records API is disabled", 409);
    return { data: await svc().records(auth(request).sub) };
  });
  app.get("/v1/credit/score", async (request) => svc().creditScore(auth(request).sub));
  app.post("/v1/credit/consents", async (request, reply) =>
    idempotent(request, reply, auth(request).sub, async () => {
      if (!deps.config.CREDIT_ENABLED) throw new DomainError("CAPABILITY_GATED", "Consent sharing is disabled", 409);
      const business = await repo().businessByUser(auth(request).sub);
      if (!business) throw new DomainError("NOT_FOUND", "Business missing", 404);
      const body = request.body as { lender_name: string; ttl_seconds?: number };
      const row = {
        id: newId("cns"),
        businessId: business.id,
        lenderName: body.lender_name,
        tokenHash: sha256Hex(newId("tok")),
        expiresAt: new Date(Date.now() + (body.ttl_seconds ?? 86400) * 1000).toISOString(),
        revokedAt: null,
      };
      await repo().saveConsent(row);
      return { id: row.id, lender_name: row.lenderName, expires_at: row.expiresAt };
    }),
  );
  app.delete("/v1/credit/consents/:id", async (request) => {
    const business = await repo().businessByUser(auth(request).sub);
    if (!business) throw new DomainError("NOT_FOUND", "Business missing", 404);
    await repo().revokeConsent((request.params as { id: string }).id, business.id);
    return { revoked: true };
  });
  app.get("/v1/credit/consents", async (request) => {
    const business = await repo().businessByUser(auth(request).sub);
    if (!business) throw new DomainError("NOT_FOUND", "Business missing", 404);
    return { data: await repo().consents(business.id) };
  });
  app.get("/v1/records/export", async (request) => ({ data: await svc().records(auth(request).sub), format: "json" }));

  const admin = (request: FastifyRequest) => {
    const user = auth(request);
    if (user.role !== "ADMIN") throw new DomainError("FORBIDDEN", "Admin role required", 403);
    return user;
  };
  app.get("/v1/admin/trades", async (request) => {
    admin(request);
    const query = request.query as { state?: string; corridor?: string };
    return { data: await repo().trades({ state: query.state, corridorId: query.corridor }) };
  });
  app.get("/v1/admin/disputes", async (request) => {
    admin(request);
    return { data: await repo().disputes() };
  });
  app.post("/v1/admin/disputes/:id/resolve", async (request, reply) =>
    idempotent(request, reply, admin(request).sub, () => {
      const body = request.body as { decision: "RELEASE" | "REFUND" | "SPLIT"; note: string };
      return svc().resolveDispute(admin(request).sub, (request.params as { id: string }).id, body);
    }),
  );
  app.post("/v1/admin/payouts/:id/recheck", async (request, reply) =>
    idempotent(request, reply, admin(request).sub, () => svc().recheckPayout(admin(request).sub, (request.params as { id: string }).id)),
  );
  app.post("/v1/admin/payouts/:id/retry", async (request, reply) =>
    idempotent(request, reply, admin(request).sub, () => svc().retryPayout(admin(request).sub, (request.params as { id: string }).id)),
  );
  app.get("/v1/admin/reconciliation", async (request) => {
    admin(request);
    const report = await svc().reconciliation([]);
    return {
      ...report,
      note: "This response does not include live Payaza balances. Run npm run reconcile to compare BUYER_CLEARING with Payaza accountBalance.",
    };
  });
  app.get("/v1/admin/payaza-events", async (request) => {
    admin(request);
    return { data: await repo().unprocessedPayazaEvents() };
  });
  app.post("/v1/admin/payaza-events/:id/replay", async (request) => {
    admin(request);
    const events = await repo().unprocessedPayazaEvents();
    const event = events.find((row) => row.id === (request.params as { id: string }).id);
    if (!event) throw new DomainError("NOT_FOUND", "Event not found", 404);
    const result = await svc().ingestPayazaBody(event.rawBody);
    await repo().markPayazaEvent(event.id, null);
    return result;
  });
  app.get("/v1/admin/feature-flags", async (request) => {
    admin(request);
    return { data: await repo().flags() };
  });
  app.put("/v1/admin/feature-flags", async (request) => {
    const user = admin(request);
    const body = request.body as { key: string; enabled: boolean };
    await repo().setFlag(body.key, body.enabled);
    await repo().audit({ id: newId("aud"), actorId: user.sub, action: "flag.set", target: body.key, payload: body });
    return { key: body.key, enabled: body.enabled };
  });
  app.get("/v1/admin/treasury/conversions", async (request) => {
    admin(request);
    return { data: await repo().treasury() };
  });
  app.post("/v1/admin/treasury/conversions", async (request, reply) =>
    idempotent(request, reply, admin(request).sub, () => {
      const body = request.body as {
        sell_currency: "UGX" | "TZS" | "KES";
        sell_minor: string;
        buy_currency: "KES" | "UGX" | "TZS";
        buy_minor: string;
        rate: string;
        counterparty: string;
        evidence_ref: string;
      };
      return svc().recordTreasury(admin(request).sub, {
        sellCurrency: body.sell_currency,
        sellMinor: BigInt(body.sell_minor),
        buyCurrency: body.buy_currency,
        buyMinor: BigInt(body.buy_minor),
        rate: body.rate,
        counterparty: body.counterparty,
        evidenceRef: body.evidence_ref,
      });
    }),
  );
  app.get("/v1/admin/treasury/exposure", async (request) => {
    admin(request);
    return svc().exposure();
  });
  app.get("/v1/admin/health/payaza", async (request) => {
    admin(request);
    return {
      tenant: deps.config.PAYAZA_TENANT,
      key_configured: Boolean(deps.config.PAYAZA_PUBLIC_KEY),
      note: "Call scripts/verify-payaza.ts to exercise GET mainaccounts. This route does not invent a balance.",
    };
  });
  app.post("/v1/admin/sandbox/fund-collection", async (request, reply) =>
    idempotent(request, reply, admin(request).sub, async () => {
      if (deps.config.PAYAZA_TENANT !== "test") {
        throw new DomainError("CAPABILITY_GATED", "Test account funding is refused on the live tenant", 409);
      }
      const body = request.body as { transaction_reference: string; country_code: string };
      const rails = (svc() as unknown as { deps: { rails: { fundTest: (reference: string, country: string) => Promise<unknown> } } }).deps.rails;
      return rails.fundTest(body.transaction_reference, body.country_code);
    }),
  );

  app.post("/api/webhooks/mpesa/stk", async (request) => {
    const parsed = readStkCallback(request.body);
    if (parsed && deps.service) {
      try {
        await deps.service.applyMpesaResult(parsed);
      } catch (error) {
        request.log.error({ err: error }, "mpesa stk callback");
      }
    }
    return { ResultCode: 0, ResultDesc: "Accepted" };
  });

  await app.register(async (scope) => {
    scope.removeContentTypeParser("application/json");
    scope.addContentTypeParser("application/json", { parseAs: "buffer" }, (_request, body, done) => {
      done(null, body);
    });
    scope.post("/api/webhooks/payaza", async (request, reply) => {
      const raw = request.body as Buffer;
      const header = request.headers["x-payaza-signature"];
      const secret = deps.config.PAYAZA_SECRET_KEY ?? "";
      const ok = verifyWebhookSignature(raw, typeof header === "string" ? header : undefined, secret);
      let reference: string | null = null;
      if (ok) {
        try {
          const parsed = JSON.parse(raw.toString("utf8")) as { transaction_reference?: string };
          reference = parsed.transaction_reference ?? null;
        } catch {
          reference = null;
        }
      }
      const id = newId("pev");
      if (deps.repo) {
        await deps.repo.savePayazaEvent({
          id,
          rawBody: raw.toString("utf8"),
          signatureOk: ok,
          transactionReference: reference,
          dedupeKey: reference ? `${reference}:${sha256Hex(raw.toString("utf8")).slice(0, 16)}` : null,
        });
      }
      if (!ok) {
        request.log.error({ id }, "payaza webhook signature rejected");
        return reply.code(401).send({
          error: { code: "UNAUTHENTICATED", message: "Invalid Payaza signature", request_id: request.id },
        });
      }
      if (deps.repo) {
        try {
          await svc().ingestPayazaBody(raw.toString("utf8"));
          await deps.repo.markPayazaEvent(id, null);
        } catch (error) {
          await deps.repo.markPayazaEvent(id, error instanceof Error ? error.message : "process failed");
        }
      }
      return reply.code(200).send({ received: true });
    });
  });

  return app;
}

function stream(reply: FastifyReply, payload: unknown) {
  reply.hijack();
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  reply.raw.write(`event: trade.state_changed\ndata: ${JSON.stringify(payload)}\n\n`);
  reply.raw.end();
}

function publicPayout(row: { id: string; tradeId: string; status: string; transactionReference: string; amountMinor: bigint; currency: string; failureConfirmed: boolean }) {
  return {
    id: row.id,
    trade_id: row.tradeId,
    status: row.status,
    transaction_reference: row.transactionReference,
    amount: { amount_minor: row.amountMinor.toString(), currency: row.currency },
    failure_confirmed: row.failureConfirmed,
  };
}
