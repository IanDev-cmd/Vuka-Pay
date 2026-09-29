import type { NetworkOption } from "./types";

/** Display names from the buyer checkout brief. Codes stay null until the API returns them. */
export const CORRIDOR_NETWORKS: Record<"UGX" | "TZS" | "RWF", NetworkOption[]> = {
  UGX: [
    { code: null, display_name: "MTN Mobile Money" },
    { code: null, display_name: "Airtel Money" },
  ],
  TZS: [
    { code: null, display_name: "Vodacom M-Pesa" },
    { code: null, display_name: "Tigo Pesa" },
    { code: null, display_name: "Airtel Money" },
  ],
  RWF: [
    { code: null, display_name: "MTN Mobile Money" },
    { code: null, display_name: "Airtel Money" },
  ],
};

export function countryForCurrency(currency: "UGX" | "TZS" | "RWF"): "UG" | "TZ" | "RW" {
  if (currency === "UGX") return "UG";
  if (currency === "TZS") return "TZ";
  return "RW";
}
