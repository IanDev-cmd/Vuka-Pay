import type { NetworkOption } from "./types";

/** Display names from the buyer checkout brief. Codes stay null until the API returns them. */
export const CORRIDOR_NETWORKS: Record<"UGX" | "TZS", NetworkOption[]> = {
  UGX: [
    { code: null, display_name: "MTN MoMo" },
    { code: null, display_name: "Airtel" },
  ],
  TZS: [
    { code: null, display_name: "Vodacom" },
    { code: null, display_name: "Airtel" },
    { code: null, display_name: "Tigo" },
    { code: null, display_name: "Halopesa" },
  ],
};

export function countryForCurrency(currency: "UGX" | "TZS"): "UG" | "TZ" {
  return currency === "UGX" ? "UG" : "TZ";
}
