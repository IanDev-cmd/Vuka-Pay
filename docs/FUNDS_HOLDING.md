# Funds holding

Buyer funds are collected through Payaza's collection rails and remain in the VukaPay merchant balance at Payaza under conditional-release rules until delivery is verified. VukaPay does not hold funds in its own bank account. Regulatory positioning for a production pilot is to be agreed with Payaza and counsel.

This statement is also returned by `GET /v1/system/funds-holding` in English and Swahili.

It is not legal advice. Payaza has no escrow product. `VK_HOLD` is VukaPay's ledger liability. Payaza's payout status `ESCROW_SUCCESS` is a different concept: amount deducted, awaiting bank processing, reversible.
