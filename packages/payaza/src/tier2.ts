import { PayazaError } from "./errors.js";
import { PayazaHttp } from "./http.js";

/**
 * Tier 2 clients. Paths are copied from openapi.json.
 * Methods refuse to send a body until the feature flag is on AND the call site
 * passes a payload that was verified against the tenant. Default is fail closed.
 */
function gated(feature: string): never {
  throw new PayazaError({
    httpStatus: 0,
    message: `${feature} is GATED. Payaza docs do not confirm it for the KES/UGX/TZS pilot, or the tenant has not verified it.`,
    body: null,
    code: "CAPABILITY_GATED",
  });
}

export class VirtualAccountsApi {
  constructor(private readonly http: PayazaHttp) {}
  readonly paths = {
    create: "merchant-collection/merchant/virtual_account/generate_virtual_account",
    status: "merchant-collection/merchant/virtual_account/detail/virtual_account/{virtualAccountNumber}",
    transaction: "merchant-collection/transfer_notification_controller/transaction-query",
    fundTest: "merchant-collection/payaza/virtual_account/fund_test_virtual_account",
  };
  create(): Promise<never> {
    void this.http;
    return Promise.reject(gated("virtual_accounts (documented NGN-only)"));
  }
}

export class CardsApi {
  constructor(private readonly http: PayazaHttp) {}
  readonly paths = {
    charge: "card/card_charge/",
    status: "card/card_charge/transaction_status",
    refundStatus: "card/card_charge/refund_status",
  };
  charge(): Promise<never> {
    void this.http;
    return Promise.reject(gated("card.collection"));
  }
}

export class RefundsApi {
  constructor(private readonly http: PayazaHttp) {}
  readonly paths = {
    initiate: "refund-chargeback/refund/merchant/api/refund",
    history: "refund-chargeback/refund/merchant/api/refund_history",
  };
  /** Card refunds only. Mobile-money collections have no documented refund endpoint. */
  initiateCardRefund(): Promise<never> {
    void this.http;
    return Promise.reject(gated("card.refund"));
  }
}

export class AuthCaptureApi {
  constructor(private readonly http: PayazaHttp) {}
  readonly paths = {
    authorize: "card/auth_capture/authorize",
    capture: "card/auth_capture/capture",
    void: "card/auth_capture/void",
    getOne: "card/auth_capture/authorize/{authorization_reference}",
  };
  authorize(): Promise<never> {
    void this.http;
    return Promise.reject(gated("card.auth_capture_void"));
  }
}

export class PaymentLinksApi {
  constructor(private readonly http: PayazaHttp) {}
  readonly paths = {
    create: "payment-link/merchant/create-payment-link",
    update: "payment-link/merchant/update-payment-link",
    activate: "payment-link/merchant/activate-payment-link",
    deactivate: "payment-link/merchant/deactivate-payment-link",
    list: "payment-link/merchant/fetch-payment-links",
  };
  create(): Promise<never> {
    void this.http;
    return Promise.reject(gated("payment_links"));
  }
}

export class SplitsApi {
  constructor(private readonly http: PayazaHttp) {}
  readonly paths = {
    create: "settlement/settlement/merchant/split-account",
    update: "settlement/settlement/merchant/split-account/{id}",
    list: "settlement/settlement/merchant/split-account",
  };
  create(): Promise<never> {
    void this.http;
    return Promise.reject(gated("split_settlements"));
  }
}

export class SubAccountsApi {
  constructor(private readonly http: PayazaHttp) {}
  readonly paths = {
    create: "payaza-account/api/v1/subaccounts/merchant",
    enquiry: "payaza-account/api/v1/subaccounts/merchant/enquiry/{payazaSubAccountReference}",
  };
  /**
   * Docs: sub-accounts segment your own organisation. They are not for onboarding exporters.
   * TODO(payaza-verify): can a sub-account separate a held-funds balance from fee revenue?
   */
  create(): Promise<never> {
    void this.http;
    return Promise.reject(gated("sub_accounts"));
  }
}
