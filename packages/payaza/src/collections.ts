import { z } from "zod";
import { PayazaHttp } from "./http.js";

export const ProcessCollectionRequest = z
  .object({
    amount: z.number(),
    customer_number: z.string().optional(),
    transaction_reference: z.string().min(1),
    transaction_description: z.string(),
    customer_bank_code: z.string().min(1),
    currency_code: z.string().min(3),
    customer_email: z.string(),
    customer_first_name: z.string(),
    customer_last_name: z.string(),
    customer_phone_number: z.string(),
    country_code: z.string().min(2).max(2),
    redirect_url: z.string().optional(),
    id_number: z.string().optional(),
  })
  .passthrough();

export const ProcessCollectionResponse = z
  .object({
    response_code: z.string(),
    response_message: z.string().optional(),
    transaction_reference: z.string().optional(),
    requires_otp: z.boolean().optional(),
    otp_length: z.number().optional(),
    payment_token: z.string().optional(),
    payee: z.string().optional(),
    payment_method: z.string().optional(),
    transaction_channel: z.string().optional(),
    redirect_customer_to_url_processing: z.boolean().optional(),
    payment_completion_url: z.string().optional(),
    before_payment_instruction: z.string().optional(),
    after_payment_instruction: z.string().optional(),
  })
  .passthrough();

const decimalLike = z.union([z.number(), z.string()]);

export const CollectionStatusResponse = z
  .object({
    response_code: z.string(),
    transaction_reference: z.string().optional(),
    transaction_amount: decimalLike.optional(),
    transaction_fee: decimalLike.optional(),
    transaction_status: z.string().optional(),
    payer_name: z.string().optional(),
    payer_account_number: z.string().optional(),
    currency: z.string().optional(),
  })
  .passthrough();

export const TestFundingResponse = z
  .object({
    response_code: z.string(),
    response_message: z.string().optional(),
  })
  .passthrough();

export type ProcessCollectionInput = z.infer<typeof ProcessCollectionRequest>;

export class CollectionsApi {
  constructor(private readonly http: PayazaHttp) {}

  async processCollection(input: ProcessCollectionInput) {
    const body = ProcessCollectionRequest.parse(input);
    const response = await this.http.request<unknown>({
      method: "POST",
      path: "subsidiary/collections/v1/process-collection",
      body,
      productId: true,
      retry: "never",
      ambiguousReference: body.transaction_reference,
    });
    return ProcessCollectionResponse.parse(response.data);
  }

  /** Documented XOF Orange OTP step. Not used by the KE-UG / KE-TZ corridors. */
  async processOtp(input: {
    payment_token: string;
    otp_code: string;
    payee: string;
    payment_method: string;
    transaction_reference: string;
    transaction_channel: string;
    country_code: string;
  }) {
    const response = await this.http.request<unknown>({
      method: "POST",
      path: "subsidiary/collections/v1/process-otp",
      body: input,
      productId: true,
      retry: "never",
      ambiguousReference: input.transaction_reference,
    });
    return ProcessCollectionResponse.parse(response.data);
  }

  async checkStatus(transactionReference: string, countryCode: string) {
    const response = await this.http.request<unknown>({
      method: "GET",
      path: "subsidiary/collections/v1/check-status",
      query: { transaction_reference: transactionReference, country_code: countryCode },
      productId: true,
      retry: "safe",
    });
    return CollectionStatusResponse.parse(response.data);
  }

  /** Sandbox only. Payaza test-account funding. Caller must refuse this on the live tenant. */
  async fundTestCollection(transactionReference: string, countryCode: string) {
    const response = await this.http.request<unknown>({
      method: "POST",
      path: "subsidiary/funding/v1/process-collection",
      body: { transaction_reference: transactionReference, country_code: countryCode },
      productId: true,
      retry: "never",
      ambiguousReference: transactionReference,
    });
    return TestFundingResponse.parse(response.data);
  }
}

export function collectionOutcome(responseCode: string): "SUCCESS" | "PENDING" | "FAILED" | "UNKNOWN" {
  if (responseCode === "00") return "SUCCESS";
  if (responseCode === "09") return "PENDING";
  if (responseCode === "06" || responseCode === "96") return "FAILED";
  return "UNKNOWN";
}
