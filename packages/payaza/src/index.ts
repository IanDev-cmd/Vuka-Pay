import { AccountsApi } from "./accounts.js";
import { BankCodesApi, MerchantReferenceStatusApi, NameEnquiryApi } from "./reference.js";
import { CollectionsApi } from "./collections.js";
import { PayazaHttp, type PayazaHttpOptions } from "./http.js";
import {
  AuthCaptureApi,
  CardsApi,
  PaymentLinksApi,
  RefundsApi,
  SplitsApi,
  SubAccountsApi,
  VirtualAccountsApi,
} from "./tier2.js";
import { TransfersApi } from "./transfers.js";

export { verifyWebhookSignature, signBody } from "./webhooks.js";

export class PayazaClient {
  readonly http: PayazaHttp;
  readonly accounts: AccountsApi;
  readonly collections: CollectionsApi;
  readonly transfers: TransfersApi;
  readonly nameEnquiry: NameEnquiryApi;
  readonly bankCodes: BankCodesApi;
  readonly merchantReference: MerchantReferenceStatusApi;
  readonly virtualAccounts: VirtualAccountsApi;
  readonly cards: CardsApi;
  readonly refunds: RefundsApi;
  readonly authCapture: AuthCaptureApi;
  readonly paymentLinks: PaymentLinksApi;
  readonly splits: SplitsApi;
  readonly subAccounts: SubAccountsApi;

  constructor(options: PayazaHttpOptions) {
    this.http = new PayazaHttp(options);
    this.accounts = new AccountsApi(this.http);
    this.collections = new CollectionsApi(this.http);
    this.transfers = new TransfersApi(this.http);
    this.nameEnquiry = new NameEnquiryApi(this.http);
    this.bankCodes = new BankCodesApi(this.http);
    this.merchantReference = new MerchantReferenceStatusApi(this.http);
    this.virtualAccounts = new VirtualAccountsApi(this.http);
    this.cards = new CardsApi(this.http);
    this.refunds = new RefundsApi(this.http);
    this.authCapture = new AuthCaptureApi(this.http);
    this.paymentLinks = new PaymentLinksApi(this.http);
    this.splits = new SplitsApi(this.http);
    this.subAccounts = new SubAccountsApi(this.http);
  }
}

export function createPayazaClient(options: PayazaHttpOptions): PayazaClient {
  return new PayazaClient(options);
}
