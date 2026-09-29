import { DomainError } from "./errors.js";
import type { Currency } from "./money.js";
import { PHONE_RULES, type PhoneCountry } from "./phone.js";

export interface CollectionNetwork {
  currency: Currency;
  country: PhoneCountry;
  code: string;
  displayName: string;
  /** Where this code was copied from. Required. Guessed codes are rejected. */
  source: string;
}

export interface Corridor {
  id: "KE-UG" | "KE-TZ";
  code: "KEUG" | "KETZ";
  buyerCountry: PhoneCountry;
  buyerCountryAlpha3: "UGA" | "TZA";
  collectionCurrency: "UGX" | "TZS";
  payoutCurrency: "KES";
  payoutTransactionType: "mobile_money";
  enabled: true;
}

export const CORRIDORS: readonly Corridor[] = [
  {
    id: "KE-UG",
    code: "KEUG",
    buyerCountry: "UG",
    buyerCountryAlpha3: "UGA",
    collectionCurrency: "UGX",
    payoutCurrency: "KES",
    payoutTransactionType: "mobile_money",
    enabled: true,
  },
  {
    id: "KE-TZ",
    code: "KETZ",
    buyerCountry: "TZ",
    buyerCountryAlpha3: "TZA",
    collectionCurrency: "TZS",
    payoutCurrency: "KES",
    payoutTransactionType: "mobile_money",
    enabled: true,
  },
];

/**
 * The only collection bank code that appears verbatim in Payaza's KES process-collection sample.
 * Uganda and Tanzania codes are not in that sample or in the sheet export fetched on 2026-09-28.
 */
export const DOCUMENTED_COLLECTION_NETWORKS: readonly CollectionNetwork[] = [
  {
    currency: "KES",
    country: "KE",
    code: "SAFKEN",
    displayName: "SAFKEN",
    source:
      "https://docs.payaza.africa/guides/momo-collections.md process-collection sample (currency_code KES, customer_bank_code SAFKEN)",
  },
];

export function corridorById(id: string): Corridor {
  const found = CORRIDORS.find((row) => row.id === id);
  if (!found) throw new DomainError("VALIDATION_FAILED", `Unknown corridor ${id}`, 422);
  return found;
}

export function corridorForBuyerCurrency(currency: string): Corridor {
  const found = CORRIDORS.find((row) => row.collectionCurrency === currency);
  if (!found) {
    throw new DomainError("VALIDATION_FAILED", `No enabled corridor collects ${currency}`, 422);
  }
  return found;
}

export function assertCollectionNetwork(networks: CollectionNetwork[], currency: string, code: string): CollectionNetwork {
  const found = networks.find((row) => row.currency === currency && row.code === code && row.source.trim().length > 0);
  if (!found) {
    throw new DomainError(
      "CAPABILITY_GATED",
      `Collection network code ${code} for ${currency} is not in the verified Payaza code list`,
      409,
      {
        currency,
        code,
        hint: "Add the code from Payaza's MoMo sheet or support reply via PAYAZA_COLLECTION_CODES_JSON. Do not guess.",
      },
    );
  }
  return found;
}

export function phoneRuleForCorridor(corridor: Corridor) {
  return PHONE_RULES[corridor.buyerCountry];
}
