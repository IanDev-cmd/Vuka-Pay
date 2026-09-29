import type { NetworkOption } from "./types";

/** Display names from the buyer checkout brief. M-Pesa is Safaricom STK. Other codes stay null until the API returns them. */
export const CORRIDOR_NETWORKS: Record<"KES" | "UGX" | "TZS" | "RWF", NetworkOption[]> = {
  KES: [{ code: "MPESA", display_name: "M-Pesa" }],
  UGX: [
    { code: null, display_name: "MTN Mobile Money" },
    { code: null, display_name: "Airtel Money" },
    { code: "MPESA", display_name: "M-Pesa" },
  ],
  TZS: [
    { code: null, display_name: "Vodacom M-Pesa" },
    { code: null, display_name: "Tigo Pesa" },
    { code: null, display_name: "Airtel Money" },
    { code: "MPESA", display_name: "M-Pesa" },
  ],
  RWF: [
    { code: null, display_name: "MTN Mobile Money" },
    { code: null, display_name: "Airtel Money" },
    { code: "MPESA", display_name: "M-Pesa" },
  ],
};

export function countryForCurrency(currency: "KES" | "UGX" | "TZS" | "RWF"): "KE" | "UG" | "TZ" | "RW" {
  if (currency === "KES") return "KE";
  if (currency === "UGX") return "UG";
  if (currency === "TZS") return "TZ";
  return "RW";
}
