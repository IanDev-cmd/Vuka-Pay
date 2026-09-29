# VukaPay HTTP API

Base path `/v1` except `GET /health`, `GET /openapi.json`, and `POST /api/webhooks/payaza`.

Money is `{ "amount_minor": "<integer string>", "currency": "KES" }`. Mutating requests send `Idempotency-Key`. Errors are `{ "error": { "code", "message", "details", "request_id" } }`.

Buyers do not have accounts. They use a signed expiring token in `/v1/pay/:token`. Exporters use `Authorization: Bearer`.

`GET /v1/trades/:id/stream` and `GET /v1/pay/:token/stream` send the current snapshot as `trade.state_changed` and close. Poll the matching GET if you need updates. A single API process does not fan out later events to idle SSE clients.

Capability status is `GET /v1/system/capabilities`. Payaza collection and payout stay `GATED` until `scripts/verify-payaza.ts` has recorded a successful call and, for collections, a verified `customer_bank_code` is configured. The state machine itself is reported `LIVE` because it is VukaPay's ledger, not a Payaza product.

Do not describe trade-record output as a credit approval. The score endpoint says so in `disclaimer`.
