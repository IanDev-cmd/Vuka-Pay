# Open questions for Payaza

Fetched 2026-09-28 from `https://docs.payaza.africa/llms.txt`, the Tier 1 and Tier 2 guide pages, and `https://docs.payaza.africa/openapi.json` (589 KB). Nothing below is treated as implemented behaviour.

1. **FX / conversion.** `openapi.json` path list has no `fx`, `forex`, `conversion`, `exchange_rate`, or `convert` operation. How are UGX/TZS collections converted to KES, at what rate and fee? Until Payaza confirms a mechanism, `fx.settlement` stays `GATED` and cross-currency trades are refused unless an operator explicitly sets `FX_SETTLEMENT_MODE=treasury_float` and records real conversions with evidence.
2. **Multi-currency balances.** Account enquiry returns one object per currency in the sample (NGN and GHS). Can this merchant hold UGX, TZS, and KES at once, and what is settlement timing per currency?
3. **KES M-Pesa beneficiary.** Initiate Transfer documents `transaction_type: mobile_money` for KES and a 12-digit `account_number` starting with `254`. The exact `bank_code` is not in the guide sample (the sample is NGN `nuban`). Name enquiry is documented for NGN and GHS only. VukaPay will only send a `bank_code` that the Bank Codes API returns for KES with `type: mobile_money` and that matches `PAYAZA_KES_MOMO_BANK_CODE`.
4. **Collection network codes.** The MoMo sheet export (`1BOGf_mSLS6rGNm1vn3cO4A2vW9oqZVGI_PxxxXnMK9o`) fetched on 2026-09-28 lists countries only, not `customer_bank_code` values. The only code copied from a Payaza sample is `SAFKEN` on a KES process-collection example (that same sample uses a Ghana-style `233…` number; we do not copy the number). Uganda and Tanzania codes are not guessed. Put verified codes in `PAYAZA_COLLECTION_CODES_JSON`.
5. **Virtual accounts.** Guides and the virtual-account tag describe NGN static/dynamic accounts. Not offered for KES/UGX/TZS. Client methods refuse to send.
6. **Limits, fees, refunds.** No corridor fee schedule or daily cap was in the fetched docs. There is a card refund API. No mobile-money collection refund endpoint was found. Buyer refunds are specified as a payout in the buyer's currency, which stays `GATED` until a confirmed bank code and balance exist for that currency.
7. **Split settlement with mobile money.** Split-account paths exist under `/settlement/settlement/merchant/split-account`. Not verified against MoMo collections. `GATED`.
8. **Sub-accounts.** Docs say sub-accounts segment your own organisation and are not for onboarding external merchants. Not used to separate held funds from fee revenue. `GATED`.
9. **Regulatory positioning.** Conditional release of collected funds for a pilot needs Payaza and counsel. See `docs/FUNDS_HOLDING.md`. This repository is not legal advice.
10. **Live payout prerequisites.** Live Initiate Transfer requires a whitelisted egress IP, a 6-digit PIN, and PND lifted by emailing `support@payaza.africa` from the Super Admin address. Test mode is not IP-restricted. Optional `X-Payaza-Signature` (HMAC-SHA512 of the exact JSON body, secret not base64) must be activated by Payaza. `transaction_pin` is an integer in one schema and a string in the signed-request sample; we send a string.

## Doc versus OpenAPI diffs

- Getting Started calls `GET /payaza-account/api/v1/mainaccounts`. That path is not in `openapi.json`. The client still calls it because the guide does. Account enquiry `GET /payaza-account/api/v1/mainaccounts/merchant/enquiry/main` is in both.
- Transfers guide status is `GET /payaza-account/api/v1/mainaccounts/transaction/status?transaction_reference=`. OpenAPI lists `GET /payaza-account/api/v1/mainaccounts/merchant/transaction/{transaction_reference}`. The worker and payout flow use the guide path. The OpenAPI path is a separate method and is not a silent fallback.
- `Payaza ESCROW_SUCCESS` means "amount deducted, awaiting bank processing, reversible". It is mapped to in-flight, never to VukaPay `VK_HOLD`.

## FX feeds actually probed

| Source | Result on 2026-09-28 |
| --- | --- |
| `https://open.er-api.com/v6/latest/USD` | Success. KES, UGX, TZS present. |
| `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json` | Success. Dated `2026-09-28`. KES, UGX, TZS present. |
| Frankfurter `USD` to `KES,UGX,TZS` | HTTP 404. Not enabled. |
| CurrencyBeacon without a key | HTTP 401. Adapter stays off until `CURRENCYBEACON_API_KEY` exists. |

Quotes require two fresh sources and reject deviation above `FX_MAX_SOURCE_DEVIATION_BPS` (default 150). A single source fails closed.
