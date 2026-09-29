export type CapabilityStatus = "LIVE" | "SANDBOX" | "GATED";

export interface Capability {
  key: string;
  status: CapabilityStatus;
  reason?: string;
}

export interface VerificationLog {
  account?: { at: string; tenant: "test" | "live"; ok: boolean };
  collection?: { at: string; currency: string; ok: boolean };
  payout?: { at: string; currency: string; ok: boolean };
  webhook?: { at: string; ok: boolean };
  treasury?: { at: string; ok: boolean };
}

export interface CapabilityInput {
  tenant: "test" | "live";
  verification: VerificationLog;
  fxQuoteProbeOk: boolean;
  settlementMode: "none" | "treasury_float";
  smsConfigured: boolean;
  emailConfigured: boolean;
  whatsappConfigured: boolean;
  voiceConfigured: boolean;
  creditEnabled: boolean;
  collectionNetworks: { currency: string }[];
}

const NOT_EXERCISED = "Not exercised against the Payaza tenant. Nothing is marked LIVE from code alone.";

export function buildCapabilities(input: CapabilityInput): { tenant: "test" | "live"; capabilities: Capability[] } {
  const accountOk = input.verification.account?.ok === true && input.verification.account.tenant === input.tenant;
  const collectionOk = (currency: string) =>
    input.verification.collection?.ok === true && input.verification.collection.currency === currency;
  const network = (currency: string) => input.collectionNetworks.some((row) => row.currency === currency);

  const payazaRail = (key: string, exercised: boolean, extra?: string): Capability => {
    if (!exercised) return { key, status: "GATED", reason: extra ?? NOT_EXERCISED };
    return {
      key,
      status: input.tenant === "live" ? "LIVE" : "SANDBOX",
      reason: input.tenant === "live" ? undefined : "Verified on the Payaza test tenant only",
    };
  };

  return {
    tenant: input.tenant,
    capabilities: [
      payazaRail("payaza.account", accountOk),
      payazaRail(
        "momo.collection.ugx",
        collectionOk("UGX") && network("UGX"),
        network("UGX") ? NOT_EXERCISED : "No verified UGX customer_bank_code is configured",
      ),
      payazaRail(
        "momo.collection.tzs",
        collectionOk("TZS") && network("TZS"),
        network("TZS") ? NOT_EXERCISED : "No verified TZS customer_bank_code is configured",
      ),
      payazaRail(
        "momo.collection.rwf",
        collectionOk("RWF") && network("RWF"),
        network("RWF") ? NOT_EXERCISED : "No verified RWF customer_bank_code is configured",
      ),
      payazaRail(
        "momo.collection.kes",
        collectionOk("KES") && network("KES"),
        network("KES") ? NOT_EXERCISED : "SAFKEN is documented but this corridor is not the pilot collection path",
      ),
      payazaRail("payout.kes.mpesa", input.verification.payout?.ok === true && input.verification.payout.currency === "KES"),
      payazaRail("webhooks.hmac", input.verification.webhook?.ok === true, "Verifier is implemented. LIVE requires a signature checked against a real Payaza delivery."),
      {
        key: "escrow.conditional_release",
        status: "LIVE",
        reason: "VukaPay state machine and ledger. Payaza has no escrow product. Funds sit in the Payaza merchant balance.",
      },
      {
        key: "fx.quoting",
        status: input.fxQuoteProbeOk ? "LIVE" : "GATED",
        reason: input.fxQuoteProbeOk
          ? "Median of fresh external rate sources"
          : "Fewer than two fresh rate sources, or sources deviate past the threshold",
      },
      {
        key: "fx.settlement",
        status: input.verification.treasury?.ok
          ? input.tenant === "live"
            ? "LIVE"
            : "SANDBOX"
          : "GATED",
        reason: input.verification.treasury?.ok
          ? "A real treasury conversion was recorded against this tenant."
          : input.settlementMode === "treasury_float"
            ? "Treasury-float booking is enabled, but no conversion has been recorded yet. Payaza OpenAPI has no FX endpoint."
            : "Payaza OpenAPI has no FX or conversion endpoint. Cross-currency trades are refused.",
      },
      {
        key: "recipient.verification",
        status: input.smsConfigured ? "LIVE" : "GATED",
        reason: input.smsConfigured
          ? "Phone-ownership OTP. This is not Payaza name enquiry."
          : "SMS channel is not configured",
      },
      {
        key: "recipient.payaza_name_enquiry",
        status: "GATED",
        reason: "Documented for NGN and GHS only. Not used for KES, UGX, or TZS.",
      },
      { key: "virtual_accounts", status: "GATED", reason: "Documented as NGN-only. Not offered for KES, UGX, or TZS." },
      { key: "card.collection", status: "GATED", reason: "Tier 2. Disabled until verified on the tenant." },
      { key: "card.auth_capture_void", status: "GATED", reason: "Tier 2 card hold mode. Disabled until verified." },
      { key: "payment_links", status: "GATED", reason: "Tier 2. Disabled until verified." },
      { key: "split_settlements", status: "GATED", reason: "Not verified with mobile-money collections." },
      {
        key: "sub_accounts",
        status: "GATED",
        reason: "Docs restrict sub-accounts to your own organisation. Per-exporter sub-accounts are not created.",
      },
      {
        key: "credit.scoring",
        status: input.creditEnabled ? "GATED" : "GATED",
        reason: input.creditEnabled
          ? "Rules engine is on, but status stays GATED until real terminal trade records exist. The score endpoint returns insufficient_history below the threshold."
          : "credit.enabled is off",
      },
      channel("notifications.sms", input.smsConfigured),
      channel("notifications.email", input.emailConfigured),
      channel("notifications.whatsapp", input.whatsappConfigured),
      channel("notifications.voice", input.voiceConfigured),
      {
        key: "sandbox.fund_collection",
        status: input.tenant === "test" ? "SANDBOX" : "GATED",
        reason:
          input.tenant === "test"
            ? "Wraps Payaza test-account funding. Still requires test keys and an initialized collection."
            : "Refused on the live tenant",
      },
    ],
  };
}

function channel(key: string, configured: boolean): Capability {
  return configured
    ? { key, status: "LIVE" }
    : { key, status: "GATED", reason: "No provider credentials are configured" };
}
