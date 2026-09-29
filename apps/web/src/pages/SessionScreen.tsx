import { useEffect, useState } from "react";
import { ApiError, createInvoice, request, sendInvoice } from "../api";
import { CloneBoard, shareOf } from "../components/CloneBoard";
import type { PartyFace } from "../components/Avatar";
import { DeliveryActions } from "../components/DeliveryActions";
import { PhoneSheet } from "../components/PhoneSheet";
import { corridorOfDemo, placeholderQuote } from "../example";
import { formatMoney, majorToMinor, normalizePhoneDigits } from "../format";
import { countryForCurrency, CORRIDOR_NETWORKS } from "../networks";
import { PayBoard } from "./PayBoard";
import type { Money } from "../types";

type Viewer = "exporter" | "buyer";
type DisputeHours = 24 | 48 | 72;

interface SessionModel {
  state: string;
  corridor: "KE-KE" | "KE-UG" | "KE-TZ" | "KE-RW";
  tradeId: string | null;
  nfcToken: string | null;
  goods: Money;
  vukapayFee: Money | null;
  payazaLabel: string;
  exporterNet: Money | null;
  disputeHours: DisputeHours;
  shipDays: string;
  dispatchOn: string;
  invoiceNumber: string;
  rate: string | null;
  expiresAt: string | null;
  buyerAmount: Money;
  parties: { exporter: PartyFace; buyer: PartyFace };
  actions: string[];
  mpesaReference: string | null;
  limits: { min: string | null; max: string | null };
}

const EXPORTER: PartyFace = {
  display_name: "Amina Traders",
  business_name: "Amina Traders",
  avatar_url: null,
  logo_url: null,
  badge: "payout_verified",
};

const BUYER: PartyFace = {
  display_name: "Kato Wholesale",
  business_name: "Kato Wholesale",
  avatar_url: null,
  logo_url: null,
  badge: null,
};

export function SessionScreen({
  viewer,
  tradeId,
  token,
}: {
  viewer: Viewer;
  tradeId: string | null;
  token: string | null;
}) {
  const preview = !tradeId && !token;
  const demoId = tradeId?.startsWith("demo-") ? tradeId : null;
  const [model, setModel] = useState<SessionModel | null>(() => (preview || demoId ? placeholderSession(viewer, demoId) : null));
  const [error, setError] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [sheet, setSheet] = useState<"send" | "code" | "dispute" | null>(null);
  const [buyerName, setBuyerName] = useState(BUYER.display_name);
  const [code, setCode] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const editable = viewer === "exporter" && model?.state === "DRAFT";
  const canType = preview || editable;

  useEffect(() => {
    if (preview || demoId) return;
    let cancelled = false;
    const path = token ? `/v1/pay/${encodeURIComponent(token)}` : `/v1/trades/${encodeURIComponent(tradeId ?? "")}`;
    request<unknown>(path)
      .then((body) => {
        if (!cancelled) setModel((current) => sessionFromApi(body, viewer, current ?? placeholderSession(viewer)));
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load this trade");
      });
    return () => {
      cancelled = true;
    };
  }, [preview, demoId, token, tradeId, viewer]);

  const button = model ? centerButton(viewer, model) : { id: "", label: "", disabled: true, hidden: true };

  async function onButton() {
    setError(null);
    if (button.id === "continue_to_payment") {
      setPayOpen(true);
      return;
    }
    if (button.id === "send_invoice") setSheet("send");
  }

  async function postJson(path: string, body: unknown): Promise<unknown> {
    setBusy(true);
    try {
      const payload = await request<unknown>(path, { method: "POST", body: JSON.stringify(body) });
      if (payload) setModel((current) => sessionFromApi(payload, viewer, current ?? placeholderSession(viewer)));
      return payload;
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Request failed");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function send(phone: string) {
    if (!model) return;
    const minor = majorToMinor(formatMoney(model.goods), "KES");
    if (!minor) {
      setError("Enter the goods value in KES.");
      return;
    }
    const currency = collectionCurrency(model.corridor);
    const network = CORRIDOR_NETWORKS[currency][0];
    if (network?.code === "MPESA" && currency !== "KES") {
      setSheet(null);
      setError("M-Pesa collects Kenyan shillings. Choose KES as the buyer currency.");
      return;
    }
    if (!network?.code) {
      setSheet(null);
      setError("This network has no Payaza code from the corridor list yet.");
      return;
    }
    setBusy(true);
    try {
      const created = await createInvoice({
        items: [{ description: "Goods", quantity: 1, unit: { amount_minor: minor, currency: "KES" } }],
        buyer: {
          name: buyerName.trim(),
          phone: normalizePhoneDigits(phone, currency),
          country: countryForCurrency(currency),
          network: network.code,
          currency,
        },
        shipping_deadline: dispatchDate(model.shipDays),
        dispute_window_hours: model.disputeHours,
      });
      if (created.id) await sendInvoice(created.id);
      setSheet(null);
    } catch (reason: unknown) {
      setError(reason instanceof ApiError ? reason.message : "Could not send the invoice");
    } finally {
      setBusy(false);
    }
  }

  const netShare = model ? shareOf(model.exporterNet?.amount_minor, model.goods.amount_minor) : { ratio: 0, label: "—" };
  const invoiceShare = model?.exporterNet ? { ratio: Math.max(0, 100 - netShare.ratio), label: `${Math.max(0, 100 - netShare.ratio).toFixed(1)}%` } : { ratio: 50, label: "—" };

  if (payOpen && model) {
    return (
      <PayBoard
        token={token}
        onClose={() => setPayOpen(false)}
        fallbackGoods={model.corridor === "KE-KE" ? model.goods : model.buyerAmount}
        fallbackNet={model.exporterNet ?? model.goods}
        kesGoods={model.goods}
      />
    );
  }

  return (
    <>
      <CloneBoard
        title="Protected until delivery"
        rows={
          model
            ? [
                {
                  label: "Goods value",
                  value: (
                    <input
                      aria-label="Goods value"
                      inputMode="decimal"
                      disabled={!canType}
                      value={formatMoney(model.goods)}
                      onChange={(event) => {
                        const minor = majorToMinor(event.target.value, "KES");
                        if (!minor) return;
                        setModel((current) => (current ? retarget(current, current.corridor, minor, preview || Boolean(demoId)) : current));
                      }}
                    />
                  ),
                },
                {
                  label: "Ship within",
                  value: (
                    <input
                      aria-label="Ship within"
                      inputMode="numeric"
                      disabled={!canType}
                      value={model.shipDays}
                      onChange={(event) =>
                        setModel((current) =>
                          current
                            ? { ...current, shipDays: event.target.value.replace(/\D/g, ""), dispatchOn: dispatchLabel(dispatchDate(event.target.value.replace(/\D/g, ""))) }
                            : current,
                        )
                      }
                    />
                  ),
                },
                {
                  label: "Dispute window",
                  value: (
                    <select
                      aria-label="Dispute window"
                      disabled={!canType}
                      value={model.disputeHours}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (value === 24 || value === 48 || value === 72) {
                          setModel((current) => (current ? { ...current, disputeHours: value } : current));
                        }
                      }}
                    >
                      <option value={24}>24 h</option>
                      <option value={48}>48 h</option>
                      <option value={72}>72 h</option>
                    </select>
                  ),
                },
                {
                  label: "Corridor",
                  value: (
                    <select
                      aria-label="Corridor"
                      disabled={!canType}
                      value={model.corridor}
                      onChange={(event) => {
                        const value = event.target.value;
                        if (value === "KE-KE" || value === "KE-UG" || value === "KE-TZ" || value === "KE-RW") {
                          setModel((current) => (current ? retarget(current, value, current.goods.amount_minor, preview || Boolean(demoId)) : current));
                        }
                      }}
                    >
                      <option value="KE-KE">Kenya · M-Pesa</option>
                      <option value="KE-UG">Kenya → Uganda</option>
                      <option value="KE-TZ">Kenya → Tanzania</option>
                      <option value="KE-RW">Kenya → Rwanda</option>
                    </select>
                  ),
                },
              ]
            : [
                { label: "Goods value", value: "…" },
                { label: "Ship within", value: "…" },
                { label: "Dispute window", value: "…" },
                { label: "Corridor", value: "…" },
              ]
        }
        stats={
          model
            ? [
                { label: "Invoice total", value: formatMoney(model.goods), share: invoiceShare.label, tone: "light" },
                {
                  label: "Exporter receives",
                  value: model.exporterNet ? formatMoney(model.exporterNet) : "—",
                  share: netShare.label,
                  tone: "blue",
                },
              ]
            : [
                { label: "Invoice total", value: "…", share: "—", tone: "light" },
                { label: "Exporter receives", value: "…", share: "—", tone: "blue" },
              ]
        }
        chart={netShare.ratio}
        totalLabel={model ? progressLine(model.state) : "Held until delivery"}
        totalValue={model ? formatMoney(model.state === "PAID_OUT" ? (model.exporterNet ?? model.goods) : model.goods, true) : "—"}
        actionLabel={button.hidden ? "Held until delivery" : button.label}
        actionDisabled={button.hidden || button.disabled || busy || !model}
        onAction={() => void onButton()}
        note={error ?? (model?.state === "PAID_OUT" && model.mpesaReference ? `M-Pesa ${model.mpesaReference}` : null)}
        extra={
          !preview && model ? (
            <DeliveryActions
              viewer={viewer}
              state={model.state}
              nfcToken={model.nfcToken}
              busy={busy}
              onShip={async () => {
                if (!tradeId) return null;
                const payload = await postJson(`/v1/trades/${encodeURIComponent(tradeId)}/ship`, {});
                if (!payload || typeof payload !== "object" || !("nfc_token" in payload)) return null;
                const tokenValue = (payload as { nfc_token?: unknown }).nfc_token;
                return typeof tokenValue === "string" ? tokenValue : null;
              }}
              onVerify={async (tag) => {
                const path = token
                  ? `/v1/pay/${encodeURIComponent(token)}/verify-nfc`
                  : `/v1/trades/${encodeURIComponent(tradeId ?? "")}/verify-nfc`;
                await postJson(path, { token: tag });
              }}
              onCode={() => setSheet("code")}
            />
          ) : null
        }
      />

      {sheet === "send" && model ? (
        <PhoneSheet
          title="Send invoice"
          hint="Buyer name and mobile-money number."
          currency={collectionCurrency(model.corridor)}
          flag={collectionCurrency(model.corridor) === "KES" ? "KE" : collectionCurrency(model.corridor) === "TZS" ? "TZ" : collectionCurrency(model.corridor) === "RWF" ? "RW" : "UG"}
          networks={CORRIDOR_NETWORKS[collectionCurrency(model.corridor)]}
          networkId={CORRIDOR_NETWORKS[collectionCurrency(model.corridor)][0]?.display_name ?? ""}
          onNetwork={() => undefined}
          showNetwork={false}
          name={{ value: buyerName, onChange: setBuyerName }}
          onClose={() => setSheet(null)}
          onConfirm={(phone) => void send(phone)}
        />
      ) : null}

      {sheet === "code" || sheet === "dispute" ? (
        <div className="code-sheet" onClick={() => setSheet(null)} role="presentation">
          <div className="sheet" onClick={(event) => event.stopPropagation()} role="dialog">
            <h2>{sheet === "code" ? "Confirm delivery" : "Raise a dispute"}</h2>
            <input
              value={sheet === "code" ? code : reason}
              onChange={(event) => (sheet === "code" ? setCode(event.target.value) : setReason(event.target.value))}
              placeholder={sheet === "code" ? "Delivery code" : "Reason"}
            />
            <button
              type="button"
              className="sheet-action"
              onClick={() => {
                if (!token) {
                  setError("Open the buyer link to do this.");
                  setSheet(null);
                  return;
                }
                const path = sheet === "code" ? `/v1/pay/${encodeURIComponent(token)}/confirm-delivery` : `/v1/pay/${encodeURIComponent(token)}/dispute`;
                const body = sheet === "code" ? { code } : { reason, evidence: [] };
                setSheet(null);
                void postJson(path, body);
              }}
            >
              Confirm
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

function retarget(current: SessionModel, corridor: SessionModel["corridor"], goodsMinor: string, useEngine: boolean): SessionModel {
  if (!useEngine) {
    return {
      ...current,
      corridor,
      goods: { amount_minor: goodsMinor, currency: "KES" },
      buyerAmount: corridor === "KE-KE" ? { amount_minor: goodsMinor, currency: "KES" } : current.buyerAmount,
      vukapayFee: null,
      exporterNet: null,
    };
  }
  const quote = placeholderQuote(corridor, BigInt(goodsMinor));
  return {
    ...current,
    corridor,
    goods: quote.fees.goods,
    vukapayFee: quote.fees.vukapay_fee,
    exporterNet: quote.exporter_net,
    rate: quote.rate,
    expiresAt: quote.expires_at,
    buyerAmount: quote.buyer_amount,
  };
}

function placeholderSession(viewer: Viewer, demoId: string | null = null): SessionModel {
  const corridor = corridorOfDemo(demoId);
  const quote = placeholderQuote(corridor);
  const state =
    demoId === "demo-tz" ? "FUNDED" : demoId === "demo-rw" ? "SHIPPED" : demoId === "demo-ke" ? "PAYMENT_PENDING" : viewer === "exporter" ? "DRAFT" : "AWAITING_PAYMENT";
  return {
    state,
    corridor,
    goods: quote.fees.goods,
    vukapayFee: quote.fees.vukapay_fee,
    payazaLabel: "Recorded on settlement",
    exporterNet: quote.exporter_net,
    disputeHours: 48,
    shipDays: "6",
    dispatchOn: "4 Oct",
    invoiceNumber: quote.invoice_number,
    rate: quote.rate,
    expiresAt: quote.expires_at,
    buyerAmount: quote.buyer_amount,
    parties: { exporter: EXPORTER, buyer: BUYER },
    actions: viewer === "exporter" ? ["send_invoice"] : ["continue_to_payment"],
    mpesaReference: null,
    tradeId: demoId,
    nfcToken: null,
    limits: { min: null, max: null },
  };
}

function collectionCurrency(corridor: string): "KES" | "UGX" | "TZS" | "RWF" {
  if (corridor === "KE-KE") return "KES";
  if (corridor === "KE-TZ") return "TZS";
  if (corridor === "KE-RW") return "RWF";
  return "UGX";
}

function sessionFromApi(body: unknown, viewer: Viewer, fallback: SessionModel): SessionModel {
  if (!body || typeof body !== "object") return fallback;
  const row = body as Record<string, unknown>;
  const fees = isRecord(row.fee_breakdown) ? row.fee_breakdown : {};
  const goods = moneyOf(fees.goods) ?? moneyOf(row.kes_total) ?? fallback.goods;
  const net = moneyOf(fees.exporter_net) ?? moneyOf(row.exporter_net);
  const fee = moneyOf(fees.vukapay_fee);
  const buyer = moneyOf(row.buyer_amount) ?? fallback.buyerAmount;
  const parties = isRecord(row.parties) ? row.parties : {};
  const state = typeof row.state === "string" ? row.state : fallback.state;
  const actions = Array.isArray(row.available_actions) ? row.available_actions.filter((item): item is string => typeof item === "string") : fallback.actions;
  return {
    ...fallback,
    state,
    goods,
    vukapayFee: fee,
    exporterNet: net,
    buyerAmount: buyer.currency === "KES" || buyer.currency === "UGX" || buyer.currency === "TZS" || buyer.currency === "RWF" ? buyer : fallback.buyerAmount,
    tradeId: typeof row.id === "string" ? row.id : fallback.tradeId,
    nfcToken: typeof row.nfc_token === "string" ? row.nfc_token : null,
    payazaLabel: typeof fees.payaza_processing === "string" ? "Recorded on settlement" : fallback.payazaLabel,
    invoiceNumber: typeof row.invoice_id === "string" ? row.invoice_id : fallback.invoiceNumber,
    rate: typeof row.rate === "string" ? row.rate : fallback.rate,
    expiresAt: typeof row.quote_expires_at === "string" ? row.quote_expires_at : fallback.expiresAt,
    disputeHours: row.dispute_window_hours === 24 || row.dispute_window_hours === 48 || row.dispute_window_hours === 72 ? row.dispute_window_hours : fallback.disputeHours,
    dispatchOn: typeof row.shipping_deadline === "string" ? dispatchLabel(row.shipping_deadline) : fallback.dispatchOn,
    mpesaReference: typeof row.mpesa_reference === "string" ? row.mpesa_reference : null,
    actions,
    parties: {
      exporter: partyOf(parties.exporter, fallback.parties.exporter),
      buyer: partyOf(parties.buyer, fallback.parties.buyer),
    },
    corridor:
      row.corridor === "KE-KE" || row.corridor === "KE-TZ" || row.corridor === "KE-RW" || row.corridor === "KE-UG"
        ? row.corridor
        : fallback.corridor,
  };
}

function centerButton(viewer: Viewer, model: SessionModel): { id: string; label: string; disabled: boolean; hidden: boolean } {
  if (model.actions.includes("send_invoice")) return { id: "send_invoice", label: "Send invoice", disabled: false, hidden: false };
  if (model.actions.includes("continue_to_payment")) return { id: "continue_to_payment", label: "Continue to payment", disabled: false, hidden: false };
  if (viewer === "exporter" && (model.state === "INVOICED" || model.state === "AWAITING_PAYMENT" || model.state === "PAYMENT_PENDING")) {
    return { id: "wait", label: "Waiting for buyer", disabled: true, hidden: false };
  }
  return { id: "", label: "", disabled: true, hidden: true };
}

function progressLine(state: string): string {
  if (state === "DRAFT") return "Step 1 of 4 · Terms";
  if (state === "FUNDED" || state === "SHIPPED" || state === "DELIVERY_CLAIMED" || state === "DISPUTED") return "Step 3 of 4 · Delivery";
  if (state === "PAID_OUT" || state === "REFUNDED") return "Step 4 of 4 · Paid out";
  return "Step 2 of 4 · Payment";
}

function dispatchDate(days: string): string {
  const count = Number(days);
  const date = new Date();
  if (Number.isFinite(count)) date.setDate(date.getDate() + count);
  return date.toISOString();
}

function dispatchLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Nairobi" });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function moneyOf(value: unknown): Money | null {
  if (!isRecord(value) || typeof value.amount_minor !== "string") return null;
  if (value.currency !== "KES" && value.currency !== "UGX" && value.currency !== "TZS" && value.currency !== "RWF") return null;
  return { amount_minor: value.amount_minor, currency: value.currency };
}

function partyOf(value: unknown, fallback: PartyFace): PartyFace {
  if (!isRecord(value)) return fallback;
  return {
    display_name: typeof value.display_name === "string" ? value.display_name : fallback.display_name,
    business_name: typeof value.business_name === "string" ? value.business_name : fallback.business_name,
    avatar_url: typeof value.avatar_url === "string" ? value.avatar_url : null,
    logo_url: typeof value.logo_url === "string" ? value.logo_url : null,
    badge: value.badge === "payout_verified" ? "payout_verified" : null,
  };
}
