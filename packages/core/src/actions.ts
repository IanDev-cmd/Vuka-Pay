import type { TradeState } from "./escrow.js";

export const DISPUTE_WINDOW_HOURS = [24, 48, 72] as const;
export type DisputeWindowHours = (typeof DISPUTE_WINDOW_HOURS)[number];

export type SessionViewer = "exporter" | "buyer";

/** Actions the viewer can perform. Status sentences are not actions. */
export type SessionAction =
  | "send_invoice"
  | "continue_to_payment"
  | "ship"
  | "add_evidence"
  | "confirm_delivery"
  | "dispute"
  | "view_evidence";

export function isDisputeWindow(value: number): value is DisputeWindowHours {
  return (DISPUTE_WINDOW_HOURS as readonly number[]).includes(value);
}

export function availableActions(state: TradeState, viewer: SessionViewer): SessionAction[] {
  if (viewer === "exporter") {
    if (state === "DRAFT") return ["send_invoice"];
    if (state === "FUNDED") return ["ship", "add_evidence"];
    if (state === "SHIPPED" || state === "DELIVERY_CLAIMED") return ["view_evidence"];
    return [];
  }
  if (state === "INVOICED" || state === "AWAITING_PAYMENT" || state === "PAYMENT_FAILED" || state === "EXPIRED") {
    return ["continue_to_payment"];
  }
  if (state === "SHIPPED" || state === "DELIVERY_CLAIMED") return ["confirm_delivery", "dispute", "view_evidence"];
  return [];
}
