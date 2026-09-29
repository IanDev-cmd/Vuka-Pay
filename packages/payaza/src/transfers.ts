import { z } from "zod";
import { PayazaHttp } from "./http.js";

const Sender = z.object({
  sender_name: z.string(),
  sender_id: z.string().optional(),
  sender_phone_number: z.string(),
  sender_address: z.string(),
  dial_code: z.string().optional(),
});

const Beneficiary = z.object({
  credit_amount: z.number(),
  account_number: z.string(),
  account_name: z.string(),
  bank_code: z.string(),
  narration: z.string().max(25),
  transaction_reference: z.string().min(10),
  sender: Sender,
});

export const InitiateTransferRequest = z.object({
  transaction_type: z.string(),
  service_payload: z.object({
    payout_amount: z.number(),
    transaction_pin: z.string().regex(/^\d{6}$/),
    account_reference: z.string(),
    currency: z.string(),
    country: z.string(),
    payout_beneficiaries: z.array(Beneficiary).min(1),
  }),
});

export const InitiateTransferResponse = z
  .object({
    response_code: z.union([z.number(), z.string()]).optional(),
    response_message: z.string().optional(),
    resp_code: z.string().optional(),
    response_content: z
      .object({
        transaction_status: z.string().optional(),
        response_status: z.string().optional(),
        response_description: z.string().optional(),
        amount: z.number().optional(),
        batch_reference: z.string().optional(),
        message: z.string().optional(),
        response_code: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const TransferStatusResponse = z
  .object({
    message: z.string().optional(),
    status: z.boolean().optional(),
    data: z
      .object({
        transactionReference: z.string().optional(),
        transactionStatus: z.string().optional(),
        transactionAmount: z.number().optional(),
        fee: z.number().optional(),
        responseCode: z.string().optional(),
        responseMessage: z.string().optional(),
        currency: z.string().optional(),
        beneficiaryName: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const IN_FLIGHT_PAYOUT_STATUSES = new Set([
  "TRANSACTION_INITIATED",
  "NIP_PENDING",
  "ESCROW_SUCCESS",
]);

export type PayoutBeneficiary = z.infer<typeof Beneficiary>;

export class TransfersApi {
  constructor(private readonly http: PayazaHttp) {}

  async initiate(input: z.infer<typeof InitiateTransferRequest>) {
    const body = InitiateTransferRequest.parse(input);
    const sum = body.service_payload.payout_beneficiaries.reduce((total, row) => total + row.credit_amount, 0);
    if (sum !== body.service_payload.payout_amount) {
      throw new Error("payout_amount must equal the sum of credit_amount");
    }
    const reference = body.service_payload.payout_beneficiaries[0]?.transaction_reference ?? "unknown";
    const response = await this.http.request<unknown>({
      method: "POST",
      path: "payout-receptor/payout",
      body,
      retry: "never",
      ambiguousReference: reference,
    });
    return InitiateTransferResponse.parse(response.data);
  }

  /**
   * Transfers guide step 4.
   * openapi.json instead lists GET /payaza-account/api/v1/mainaccounts/merchant/transaction/{transaction_reference}.
   * That alternate is getMerchantTransaction and is not used as a silent fallback.
   */
  async transactionStatus(transactionReference: string) {
    const response = await this.http.request<unknown>({
      method: "GET",
      path: "payaza-account/api/v1/mainaccounts/transaction/status",
      query: { transaction_reference: transactionReference },
      retry: "safe",
    });
    return TransferStatusResponse.parse(response.data);
  }

  async getMerchantTransaction(transactionReference: string) {
    const response = await this.http.request<unknown>({
      method: "GET",
      path: `payaza-account/api/v1/mainaccounts/merchant/transaction/${encodeURIComponent(transactionReference)}`,
      retry: "safe",
    });
    return response.data;
  }
}

export function payoutStatusGroup(status: string | undefined): "SUCCEEDED" | "FAILED" | "IN_FLIGHT" | "UNKNOWN" {
  if (status === "NIP_SUCCESS") return "SUCCEEDED";
  if (status === "NIP_FAILURE") return "FAILED";
  if (status && IN_FLIGHT_PAYOUT_STATUSES.has(status)) return "IN_FLIGHT";
  return "UNKNOWN";
}
