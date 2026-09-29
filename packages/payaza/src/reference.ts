import { z } from "zod";
import { PayazaError } from "./errors.js";
import { PayazaHttp } from "./http.js";

const NameEnquiryResponse = z
  .object({
    response_code: z.number().optional(),
    response_message: z.string().optional(),
    response_content: z
      .object({
        account_number: z.string().optional(),
        account_name: z.string().optional(),
        bank_code: z.string().optional(),
        account_status: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const SUPPORTED = new Set(["NGN", "GHS"]);

export class NameEnquiryApi {
  constructor(private readonly http: PayazaHttp) {}

  async enquire(input: { currency: string; bank_code: string; account_number: string }) {
    if (!SUPPORTED.has(input.currency)) {
      throw new PayazaError({
        httpStatus: 0,
        message: `Payaza name enquiry is documented for NGN and GHS only, not ${input.currency}`,
        body: null,
        code: "CAPABILITY_GATED",
      });
    }
    const response = await this.http.request<unknown>({
      method: "POST",
      path: "payaza-account/api/v1/mainaccounts/merchant/provider/enquiry",
      body: { service_payload: input },
      retry: "never",
    });
    return NameEnquiryResponse.parse(response.data);
  }
}

const BankCodesResponse = z
  .object({
    message: z.string().optional(),
    status: z.boolean().optional(),
    data: z.array(
      z
        .object({
          code: z.string(),
          name: z.string().optional(),
          active: z.boolean().optional(),
          type: z.string().optional(),
          currency_code: z.string().optional(),
          country_code: z.string().optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export class BankCodesApi {
  constructor(private readonly http: PayazaHttp) {}

  async list(currencyCode: string) {
    const response = await this.http.request<unknown>({
      method: "GET",
      path: `payaza-account/api/v1/mainaccounts/merchant/banks/${encodeURIComponent(currencyCode)}`,
      retry: "safe",
    });
    return BankCodesResponse.parse(response.data);
  }
}

export class MerchantReferenceStatusApi {
  constructor(private readonly http: PayazaHttp) {}

  async byMerchantReference(merchantReference: string) {
    const response = await this.http.request<unknown>({
      method: "GET",
      path: "merchant-collection/transfer_notification_controller/merchant/transaction-query",
      query: { merchant_reference: merchantReference },
      retry: "safe",
    });
    return response.data;
  }
}
