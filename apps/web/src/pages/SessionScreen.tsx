import { useEffect, useState } from "react";
import { ApiError, createInvoice, listTrades, sendInvoice } from "../api";
import { Avatar, type PartyFace } from "../components/Avatar";
import { PhoneSheet } from "../components/PhoneSheet";
import { placeholderQuote } from "../example";
import { formatMoney, majorToMinor, normalizePhoneDigits } from "../format";
import { navigate } from "../nav";
import { countryForCurrency, CORRIDOR_NETWORKS } from "../networks";
import { BuyerScreen } from "./BuyerScreen";
import type { Money } from "../types";

type Viewer = "exporter" | "buyer";
type DisputeHours = 24 | 48 | 72;

interface SessionModel {
  state: string;
  corridor: "KE-UG" | "KE-TZ";
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
  page = "session",
}: {
  viewer: Viewer;
  tradeId: string | null;
  token: string | null;
  page?: "session" | "trades" | "how" | "support";
}) {
  const preview = !tradeId && !token;
  const [model, setModel] = useState<SessionModel | null>(() => (preview ? placeholderSession(viewer) : null));
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [sheet, setSheet] = useState<"send" | "code" | "dispute" | null>(null);
  const [buyerName, setBuyerName] = useState(BUYER.display_name);
  const [code, setCode] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [trades, setTrades] = useState<{ id: string; state: string }[] | null>(null);

  const editable = viewer === "exporter" && model?.state === "DRAFT";

  useEffect(() => {
    if (preview) return;
    let cancelled = false;
    const path = token ? `/v1/pay/${encodeURIComponent(token)}` : `/v1/trades/${encodeURIComponent(tradeId ?? "")}`;
    fetch(path, { headers: { Accept: "application/json" } })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          const message = body && typeof body === "object" && body.error?.message ? String(body.error.message) : response.statusText;
          throw new Error(message);
        }
        return body;
      })
      .then((body) => {
        if (!cancelled) setModel((current) => sessionFromApi(body, viewer, current ?? placeholderSession(viewer)));
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load this trade");
      });
    return () => {
      cancelled = true;
    };
  }, [preview, token, tradeId, viewer]);

  useEffect(() => {
    if (!payOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setPayOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [payOpen]);

  useEffect(() => {
    if (page !== "trades") return;
    listTrades()
      .then((rows) => {
        setTrades(rows);
        setError(null);
      })
      .catch((reason: unknown) => {
        setTrades([]);
        const message = reason instanceof Error ? reason.message : "Could not load trades";
        setError(message === "Internal Server Error" ? "Could not load trades" : message);
      });
  }, [page]);

  const button = model ? centerButton(viewer, model) : { id: "", label: "", disabled: true, hidden: true };
  const faces = model ? partyCards(model) : [];

  async function onButton() {
    setError(null);
    if (button.id === "continue_to_payment") {
      setPayOpen(true);
      return;
    }
    if (button.id === "send_invoice") setSheet("send");
  }

  async function postJson(path: string, body: unknown) {
    setBusy(true);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message = payload && typeof payload === "object" && payload.error?.message ? String(payload.error.message) : response.statusText;
        throw new Error(message);
      }
      if (payload) setModel((current) => sessionFromApi(payload, viewer, current ?? placeholderSession(viewer)));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Request failed");
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
    const currency = model.corridor === "KE-UG" ? "UGX" : "TZS";
    const network = CORRIDOR_NETWORKS[currency][0];
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

  return (
    <div className="session-page">
      <div className="session-shell">
        <header className="session-bar">
          <button type="button" className="wordmark" onClick={() => navigate("/")}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2.2 8.2 L6.1 12.1 L13.8 3.6" fill="none" stroke="#1bb82b" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            VukaPay
          </button>
          <div className="session-tools">
          <nav className={menu ? "session-nav open" : "session-nav"}>
            <button type="button" aria-current={page === "trades" ? "page" : undefined} onClick={() => navigate("/trades")}>
              Trades
            </button>
            <button type="button" aria-current={page === "how" ? "page" : undefined} onClick={() => navigate("/how-it-works")}>
              How it works
            </button>
            <button type="button" aria-current={page === "session" ? "page" : undefined} onClick={() => navigate(viewer === "exporter" ? "/invoice" : "/")}>
              Session
            </button>
            <button type="button" onClick={() => navigate("/wallet")}>
              Wallet
            </button>
            <button type="button" aria-current={page === "support" ? "page" : undefined} onClick={() => navigate("/support")}>
              Support
            </button>
          </nav>
          <button type="button" className="menu-button" aria-label="Menu" onClick={() => setMenu((open) => !open)}>
            <span />
            <span />
            <span />
          </button>
          </div>
        </header>

        {page === "trades" ? (
          <section className="plain-page">
            <h1>Trades</h1>
            {trades === null && !error ? <p>…</p> : null}
            {(trades ?? []).map((row) => (
              <button key={row.id} type="button" className="next-card" onClick={() => navigate(`/trades/${row.id}`)}>
                <span className="next-copy">
                  <strong>{row.id}</strong>
                  <small>→</small>
                </span>
              </button>
            ))}
            {error ? (
              <button type="button" className="next-card" onClick={() => navigate("/")}>
                <span className="next-copy">
                  <strong>Amina Traders → Kato Wholesale</strong>
                  <small>→</small>
                </span>
              </button>
            ) : null}
            {trades && trades.length === 0 && !error ? <p>—</p> : null}
          </section>
        ) : null}

        {page === "how" || page === "support" ? (
          <section className="plain-page">
            <h1>{page === "how" ? "How it works" : "Support"}</h1>
            <p>We hold your money safely until the goods arrive.</p>
          </section>
        ) : null}

        {page === "session" && !model ? <p className="progress-line">{error ?? "…"}</p> : null}

        {page === "session" && model ? (
          <div className="session-grid">
            <div className="headline-block">
              <h1 className="session-title">
                Your trade is protected
                <br />
                until <em>delivery</em>
              </h1>
              <p className="progress-line">{progressLine(model.state)}</p>
            </div>

            <article className="summary-card">
              <div className="party-row">
                <div className="party-faces">
                  <Avatar party={model.parties.exporter} size={42} />
                  <Avatar party={model.parties.buyer} size={42} />
                </div>
                <p className="party-names">
                  {model.parties.exporter.display_name} → {model.parties.buyer.display_name}
                </p>
              </div>
              <p className="summary-kicker">{model.state === "PAID_OUT" ? "Paid out" : "Invoice total"}</p>
              <p className="summary-total">
                {model.state === "PAID_OUT"
                  ? formatMoney(model.exporterNet ?? model.goods, true)
                  : formatMoney(model.goods, true)}
              </p>
              <div className="fee-row">
                <span>Goods value</span>
                <strong>{formatMoney(model.goods, true)}</strong>
              </div>
              <div className="fee-row">
                <span>VukaPay fee</span>
                <strong>{model.vukapayFee ? formatMoney(model.vukapayFee, true) : "—"}</strong>
              </div>
              <div className="fee-row">
                <span>Payaza processing fee</span>
                <strong>{model.payazaLabel}</strong>
              </div>
              <div className="fee-row">
                <span>Exporter receives</span>
                <strong>{model.exporterNet ? formatMoney(model.exporterNet, true) : "—"}</strong>
              </div>
              {model.state === "PAID_OUT" ? (
                <div className="fee-row">
                  <span>M-Pesa reference</span>
                  <strong>{model.mpesaReference ?? "—"}</strong>
                </div>
              ) : null}
              {button.hidden ? null : (
                <button type="button" className="summary-button" disabled={button.disabled || busy} onClick={() => void onButton()}>
                  {button.label}
                </button>
              )}
              {viewer === "buyer" && model.state === "PAID_OUT" ? <p className="hint">Receipt</p> : null}
            </article>

            <aside className="next-column">
              <h2>What to do next?</h2>
              {faces.map((card) => (
                <article key={card.id} className="next-card">
                  <span className="next-copy">
                    <strong>{card.label}</strong>
                    <small>→</small>
                  </span>
                  <Avatar party={card.party} size={56} />
                </article>
              ))}
              {error ? <p className="session-error">{error}</p> : null}
            </aside>

            <section className={termsOpen ? "terms open" : "terms"}>
              <button type="button" className="terms-toggle field-name" onClick={() => setTermsOpen((open) => !open)}>
                Deal terms
              </button>
              <div className="terms-body">
                <label className="field">
                  <span className="field-name">Goods value</span>
                  <div className="money-box">
                    <span>KES</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      disabled={!editable}
                      value={formatMoney(model.goods)}
                      onChange={(event) => {
                        const minor = majorToMinor(event.target.value, "KES");
                        if (!minor) return;
                        setModel((current) =>
                          current
                            ? {
                                ...current,
                                goods: { amount_minor: minor, currency: "KES" },
                                vukapayFee: null,
                                exporterNet: null,
                              }
                            : current,
                        );
                      }}
                    />
                    <div className="slider-track" aria-hidden="true">
                      <span className="slider-thumb" />
                    </div>
                  </div>
                  <div className="range-labels">
                    <span>{model.limits.min ?? ""}</span>
                    <span>{model.limits.max ?? ""}</span>
                  </div>
                </label>
                <div className="field">
                  <span className="field-name">Ship within</span>
                  <div className="split">
                    <input
                      type="text"
                      inputMode="numeric"
                      disabled={!editable}
                      value={model.shipDays}
                      onChange={(event) =>
                        setModel((current) =>
                          current ? { ...current, shipDays: event.target.value.replace(/\D/g, ""), dispatchOn: dispatchLabel(dispatchDate(event.target.value.replace(/\D/g, ""))) } : current,
                        )
                      }
                    />
                    <div className="suffix-box">days</div>
                  </div>
                  <p className="hint">Dispatch by {model.dispatchOn}</p>
                </div>
                <div className="pair">
                  <label className="field">
                    <span className="field-name">Dispute window</span>
                    <select
                      disabled={!editable}
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
                  </label>
                  <label className="field">
                    <span className="field-name">Corridor</span>
                    <div className="readonly-box">{model.corridor === "KE-UG" ? "Kenya → Uganda" : "Kenya → Tanzania"}</div>
                  </label>
                </div>
              </div>
            </section>
          </div>
        ) : null}
      </div>

      {payOpen && model ? (
        <div className="pay-overlay" role="dialog" aria-label="Payment">
          <div>
            <div className="pay-overlay-bar">
              <button type="button" onClick={() => setPayOpen(false)}>
                Close
              </button>
            </div>
            <BuyerScreen token={token} embedded party={model.parties.exporter} />
          </div>
        </div>
      ) : null}

      {sheet === "send" && model ? (
        <PhoneSheet
          title="Send invoice"
          hint="Buyer name and mobile-money number."
          currency={model.corridor === "KE-UG" ? "UGX" : "TZS"}
          flag={model.corridor === "KE-UG" ? "UG" : "TZ"}
          networks={CORRIDOR_NETWORKS[model.corridor === "KE-UG" ? "UGX" : "TZS"]}
          networkId={CORRIDOR_NETWORKS[model.corridor === "KE-UG" ? "UGX" : "TZS"][0]?.display_name ?? ""}
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
    </div>
  );
}

function placeholderSession(viewer: Viewer): SessionModel {
  const quote = placeholderQuote();
  return {
    state: viewer === "exporter" ? "DRAFT" : "AWAITING_PAYMENT",
    corridor: "KE-UG",
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
    limits: { min: null, max: null },
  };
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
    buyerAmount: buyer.currency === "UGX" || buyer.currency === "TZS" ? buyer : fallback.buyerAmount,
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
    corridor: row.corridor === "KE-TZ" ? "KE-TZ" : row.corridor === "KE-UG" ? "KE-UG" : fallback.corridor,
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

function partyCards(model: SessionModel): { id: string; label: string; party: PartyFace }[] {
  const exporter = model.parties.exporter;
  const business = exporter.business_name || exporter.display_name;
  return [
    { id: "exporter", label: exporter.display_name, party: exporter },
    { id: "buyer", label: model.parties.buyer.display_name, party: model.parties.buyer },
    {
      id: "logo",
      label: business,
      party: {
        display_name: business,
        business_name: business,
        avatar_url: null,
        logo_url: exporter.logo_url,
        badge: null,
      },
    },
  ];
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
  if (value.currency !== "KES" && value.currency !== "UGX" && value.currency !== "TZS") return null;
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
