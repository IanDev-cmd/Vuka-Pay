# VukaPay

Backend for conditional-release trade payments between Kenyan exporters and buyers paying with Ugandan or Tanzanian mobile money, on Payaza's rails.

This tree does not mark collection or payout `LIVE`. Those capabilities stay `GATED` until they have been exercised against a Payaza tenant and recorded in `docs/verification-log.json`. Payaza is not mocked. `FX_MODE=mock` runs the real quote engine on a demo USD book.

## Run

```bash
docker compose up -d
cp .env.example .env
npm install
npm run prisma:generate
npx prisma migrate dev --schema packages/db/prisma/schema.prisma --name init
npm test
npm run dev
npm run worker
```

`GET /health` answers even when `DATABASE_URL` is missing. Trade routes then return `DEPENDENCY_UNAVAILABLE`. `GET /openapi.json` is the frontend contract. A typed fetch wrapper is `@vukapay/api-client`.

## Payaza

- Base URL `https://api.payaza.africa/live/` for both tenants. The tenant is the `X-TenantID` header and the key, not the path.
- Authorization is `Payaza <base64 public key>`, not `Bearer`.
- Webhooks: verify `x-payaza-signature` as base64 HMAC-SHA512 of the raw body using the secret key. The secret is not base64-encoded.
- Live payouts need a static egress IP whitelisted in the Payaza dashboard, a transaction PIN, and PND lifted by support. Test payouts are not IP-restricted. Put the worker on a host with a fixed IP (small VPS, Fly.io static egress, Render static IPs) before live payouts.

```bash
npm run verify:payaza
```

That calls `GET mainaccounts` and account enquiry. It writes `docs/verification-log.json` only after a real response. It does not mark collections or payouts live.

## Status

| Capability | Status in this tree | Why |
| --- | --- | --- |
| UGX/TZS collection | GATED | Endpoints are implemented. Network codes for UG/TZ are not in the fetched Payaza sheet, and no test-tenant call has been recorded. |
| KES M-Pesa payout | GATED | Payout client is implemented. `bank_code` is taken only from Payaza's Bank Codes response plus `PAYAZA_KES_MOMO_BANK_CODE`. Not yet exercised. |
| Webhook HMAC | Implemented, GATED as LIVE | Verifier matches the documented algorithm. LIVE waits for a real Payaza delivery. |
| Conditional release | LIVE as VukaPay's ledger | Payaza has no escrow product. Funds sit in the Payaza merchant balance. |
| FX quoting | LIVE when two feeds respond, or the demo book when `FX_MODE=mock` | ExchangeRate-API and fawazahmed0 were probed on 2026-09-28 and both had KES, UGX, and TZS. Mock mode uses the same median, spread, and fee path on `mock-exchangerate` and `mock-fawaz`. A missing or divergent source fails closed. |
| FX settlement | GATED | OpenAPI has no conversion API. Set `FX_SETTLEMENT_MODE=treasury_float` only when KES payouts are funded from a real KES balance and conversions are recorded with evidence. |
| Virtual accounts, cards, payment links, splits, sub-accounts | GATED | Typed paths exist. Methods refuse to send. |
| Trade-record score | GATED | Off until `CREDIT_ENABLED=true`. Output is not a credit approval. |

## Money

Amounts are bigint minor units. KES exponent 2. UGX and TZS exponent 0, per the product spec. Payaza is called with major units only when the value round-trips through a JSON number.

Collection `response_code` `09` means the prompt was sent. The trade becomes `FUNDED` only from a webhook or status result with a known `amount_validation`.

## Next command

With test keys in `.env`:

```bash
npm run verify:payaza
```

Then add UG/TZ `customer_bank_code` values copied from Payaza (not guessed) and run one collection on the test tenant.
