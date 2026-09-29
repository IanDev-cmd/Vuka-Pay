import { DomainError, type Notifier, type Rails } from "@vukapay/core";
import { PayazaClient } from "@vukapay/payaza";
import type { AppConfig } from "./config.js";

export function createRails(config: AppConfig, log: (event: Record<string, unknown>) => void): Rails {
  const client = config.PAYAZA_PUBLIC_KEY
    ? new PayazaClient({
        baseUrl: config.PAYAZA_BASE_URL,
        publicKey: config.PAYAZA_PUBLIC_KEY,
        secretKey: config.PAYAZA_SECRET_KEY,
        tenant: config.PAYAZA_TENANT,
        signPayouts: config.PAYAZA_SIGN_PAYOUTS === "true",
        log,
      })
    : null;

  function requireClient() {
    if (!client) throw new DomainError("PAYAZA_UNAVAILABLE", "PAYAZA_PUBLIC_KEY is not configured", 503);
    return client;
  }

  return {
    async processCollection(input) {
      const response = await requireClient().collections.processCollection(input);
      return {
        response_code: response.response_code,
        response_message: response.response_message,
        payment_completion_url: response.payment_completion_url,
      };
    },
    async checkCollection(reference, countryCode) {
      const response = await requireClient().collections.checkStatus(reference, countryCode);
      return { response_code: response.response_code, transaction_status: response.transaction_status };
    },
    async initiatePayout(input) {
      const response = await requireClient().transfers.initiate({
        transaction_type: input.transaction_type,
        service_payload: {
          payout_amount: input.credit_amount,
          transaction_pin: input.pin,
          account_reference: input.account_reference,
          currency: input.currency,
          country: input.country,
          payout_beneficiaries: [
            {
              credit_amount: input.credit_amount,
              account_number: input.account_number,
              account_name: input.account_name,
              bank_code: input.bank_code,
              narration: input.narration,
              transaction_reference: input.transaction_reference,
              sender: {
                sender_name: input.sender_name,
                sender_phone_number: input.sender_phone_number,
                sender_address: input.sender_address,
              },
            },
          ],
        },
      });
      return {
        response_status: response.response_content?.response_status,
        batch_reference: response.response_content?.batch_reference,
        raw: response,
      };
    },
    async payoutStatus(reference) {
      const response = await requireClient().transfers.transactionStatus(reference);
      return {
        transactionStatus: response.data?.transactionStatus,
        fee: response.data?.fee,
        raw: response,
      };
    },
    async kesAccount() {
      const enquiry = await requireClient().accounts.enquiry();
      const row = enquiry.data.find((account) => account.currency === "KES");
      if (!row) return null;
      return {
        payazaAccountReference: row.payazaAccountReference,
        postNoDebit: row.postNoDebit === true,
        accountBalance: row.accountBalance,
        currency: row.currency,
      };
    },
    async kesMobileMoneyCode(pinned) {
      const list = await requireClient().bankCodes.list("KES");
      const codes = list.data.filter((row) => row.active !== false && row.type === "mobile_money").map((row) => row.code);
      if (!pinned || !codes.includes(pinned)) {
        throw new DomainError(
          "CAPABILITY_GATED",
          "Set PAYAZA_KES_MOMO_BANK_CODE to a mobile_money code returned by Payaza's Bank Codes API for KES",
          409,
          { returned_codes: codes },
        );
      }
      return pinned;
    },
    async fundTest(reference, countryCode) {
      if (config.PAYAZA_TENANT !== "test") {
        throw new DomainError("CAPABILITY_GATED", "Test account funding is refused on the live tenant", 409);
      }
      return requireClient().collections.fundTestCollection(reference, countryCode);
    },
  };
}

export function createNotifier(config: AppConfig): Notifier {
  return {
    async sms(to, body) {
      if (config.AT_USERNAME && config.AT_API_KEY) {
        const form = new URLSearchParams({ username: config.AT_USERNAME, to, message: body });
        if (config.AT_SENDER_ID) form.set("from", config.AT_SENDER_ID);
        const response = await fetch("https://api.africastalking.com/version1/messaging", {
          method: "POST",
          headers: {
            apiKey: config.AT_API_KEY,
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: form,
        });
        if (!response.ok) throw new DomainError("CAPABILITY_GATED", "SMS provider rejected the message", 502);
        return;
      }
      if (config.TWILIO_ACCOUNT_SID && config.TWILIO_AUTH_TOKEN && config.TWILIO_FROM) {
        const form = new URLSearchParams({ To: `+${to}`, From: config.TWILIO_FROM, Body: body });
        const response = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${config.TWILIO_ACCOUNT_SID}/Messages.json`,
          {
            method: "POST",
            headers: {
              Authorization: `Basic ${Buffer.from(`${config.TWILIO_ACCOUNT_SID}:${config.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: form,
          },
        );
        if (!response.ok) throw new DomainError("CAPABILITY_GATED", "SMS provider rejected the message", 502);
        return;
      }
      throw new DomainError("CAPABILITY_GATED", "No SMS provider is configured", 409);
    },
  };
}
