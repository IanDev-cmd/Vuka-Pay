import { z } from "zod";
import { PayazaHttp } from "./http.js";

const loose = z.object({}).passthrough();

const AccountRow = z
  .object({
    id: z.number().optional(),
    accountName: z.string().optional(),
    payazaAccountReference: z.string(),
    status: z.string().optional(),
    accountBalance: z.number(),
    currency: z.string(),
    country: z.string().optional(),
    postNoDebit: z.boolean().optional(),
    postNoCredit: z.boolean().optional(),
    virtualAccounts: z.array(loose).optional(),
  })
  .passthrough();

const EnquiryResponse = z
  .object({
    message: z.string().optional(),
    status: z.boolean().optional(),
    data: z.array(AccountRow),
  })
  .passthrough();

export type PayazaAccount = z.infer<typeof AccountRow>;

export class AccountsApi {
  constructor(private readonly http: PayazaHttp) {}

  /** Getting Started key check. This path is in the guide and is absent from openapi.json. */
  async mainAccounts(): Promise<unknown> {
    const response = await this.http.request<unknown>({
      method: "GET",
      path: "payaza-account/api/v1/mainaccounts",
      retry: "safe",
    });
    return response.data;
  }

  async enquiry(): Promise<z.infer<typeof EnquiryResponse>> {
    const response = await this.http.request<unknown>({
      method: "GET",
      path: "payaza-account/api/v1/mainaccounts/merchant/enquiry/main",
      retry: "safe",
    });
    return EnquiryResponse.parse(response.data);
  }

  accountForCurrency(accounts: PayazaAccount[], currency: string): PayazaAccount | undefined {
    return accounts.find((row) => row.currency === currency);
  }
}
