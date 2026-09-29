# Architecture

VukaPay collects UGX or TZS through Payaza mobile money, locks the confirmed amount in its own ledger against the Payaza merchant balance, and pays the exporter in KES to M-Pesa after delivery is verified.

## Request path

`apps/api` is Fastify. Zod and the OpenAPI registry live in `packages/contract`. Money rules live in `packages/core` and do not call Payaza. `packages/payaza` is the only HTTP client for Payaza. `apps/worker` uses pg-boss to drain the webhook inbox.

## Trade states

The transition table is `TRANSITIONS` in `packages/core/src/escrow.ts`. Illegal moves throw `ILLEGAL_STATE_TRANSITION`.

`PAYMENT_FAILED` and prompt-expiry `EXPIRED` can return to `PAYMENT_PENDING` on an explicit retry with a new Payaza reference, which is what `POST /v1/pay/:token/retry` requires. A payout that Payaza has confirmed failed returns to `RELEASE_PENDING`, `REFUND_PENDING`, or `SPLIT_PENDING` according to the original intent. It does not flip a refund into an exporter release.

## Ledger

Per currency, debits equal credits.

- Collection: debit `BUYER_CLEARING` for `amount_received`, credit `VK_HOLD` for the locked amount, credit `REFUNDS_PAYABLE` for excess. Payaza `transaction_fee` debits `PROCESSOR_FEES` and credits `BUYER_CLEARING`.
- Assumption, flagged in `OPEN_QUESTIONS.md`: `amount_received` is the gross credit and the fee is charged on top of it. If Payaza nets the fee inside `amount_received`, reconciliation will drift and the posting must change.
- At funding, the KES obligation debits `FX_CLEARING` and credits `EXPORTER_PAYABLE` and `FEE_REVENUE`. That is exposure, not KES cash.
- A KES payout debits `EXPORTER_PAYABLE` and credits `BUYER_CLEARING` KES.
- A treasury conversion recorded by an admin debits and credits each currency on its own books and requires a counterparty plus an evidence reference.

`BUYER_CLEARING` is the Payaza mirror. `reconcile()` compares it to `accountBalance`. `VK_HOLD` is not that mirror.

## FX

Quoting uses live feeds. Settlement is off unless `FX_SETTLEMENT_MODE=treasury_float`. There is no Payaza conversion client because the OpenAPI spec has no such endpoint.

## Webhooks

`POST /api/webhooks/payaza` reads the raw body, checks `x-payaza-signature` with HMAC-SHA512 before trusting the JSON, stores the inbox row, and returns. Invalid signatures are stored as rejected and are not applied to the ledger. The worker calls the same collection and payout handlers as a direct status update.
