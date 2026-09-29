import { useEffect, useState } from "react";
import { ApiError, collect, getPay, getPayStatus, refreshQuote, retryCollection } from "../api";
import { CloneBoard, shareOf } from "../components/CloneBoard";
import { PaymentQr } from "../components/PaymentQr";
import { formatMoney, normalizePhoneDigits } from "../format";
import { navigate } from "../nav";
import { CORRIDOR_NETWORKS } from "../networks";
import { paymentQrText } from "../qrPayload";
import type { BuyerQuote, Money } from "../types";

const FUNDED = new Set(["FUNDED", "SHIPPED", "DELIVERY_CLAIMED", "DISPUTED", "RELEASE_PENDING", "PAYOUT_FAILED", "PAID_OUT"]);

type Phase = "ready" | "prompt" | "received" | "failed";

export function PayBoard({
  token,
  onClose,
  fallbackGoods,
  fallbackNet,
}: {
  token: string | null;
  onClose?: () => void;
  fallbackGoods?: Money | null;
  fallbackNet?: Money | null;
}) {
  const [quote, setQuote] = useState<BuyerQuote | null>(null);
  const [phone, setPhone] = useState("");
  const [networkName, setNetworkName] = useState("M-Pesa");
  const [phase, setPhase] = useState<Phase>("ready");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getPay(token)
      .then((next) => {
        if (cancelled) return;
        setQuote(next);
        const mpesa = next.networks.find((row) => row.code === "MPESA") ?? CORRIDOR_NETWORKS[next.collection_currency].find((row) => row.code === "MPESA");
        if (mpesa) setNetworkName(mpesa.display_name);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load this pay link");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!token || phase !== "prompt") return;
    let cancelled = false;
    async function poll() {
      try {
        const next = await getPayStatus(token as string);
        if (cancelled) return;
        const funded = next.collection_status === "COMPLETED" || (next.trade_state != null && FUNDED.has(next.trade_state));
        const failed = next.collection_status === "FAILED" || next.collection_status === "EXPIRED" || next.trade_state === "PAYMENT_FAILED";
        if (funded) {
          sessionStorage.setItem("vukapay-received", "1");
          setPhase("received");
        }
        else if (failed) setPhase("failed");
      } catch (reason: unknown) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not read payment status");
      }
    }
    void poll();
    const timer = window.setInterval(() => void poll(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [token, phase]);

  useEffect(() => {
    if (phase !== "received") return;
    const timer = window.setTimeout(() => navigate("/wallet"), 2000);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const currency = quote?.collection_currency ?? fallbackGoods?.currency ?? "KES";
  const networks = quote && quote.networks.length > 0 ? quote.networks : CORRIDOR_NETWORKS[currency];
  const selected = networks.find((row) => row.display_name === networkName) ?? networks.find((row) => row.code === "MPESA") ?? networks[0];
  const youPay = quote?.buyer_amount ?? fallbackGoods ?? null;
  const exporter = quote?.exporter_net ?? quote?.exporter_receives ?? fallbackNet ?? null;
  const share = shareOf(exporter?.amount_minor, youPay?.amount_minor);
  const qr = token
    ? paymentQrText({
        invoiceId: quote?.invoice_number ?? "",
        tradeId: "",
        payToken: token,
        corridor: currency === "TZS" ? "KE-TZ" : currency === "RWF" ? "KE-RW" : currency === "KES" ? "KE-KE" : "KE-UG",
        settlementCurrency: "KES",
        amount: youPay?.amount_minor ?? "0",
        payazaCheckoutUrl: null,
      })
    : null;

  async function pay() {
    setError(null);
    if (!token) {
      setError("Open the buyer pay link to send the M-Pesa prompt.");
      return;
    }
    if (!selected?.code) {
      setError("Choose M-Pesa to send the STK prompt.");
      return;
    }
    if (selected.code === "MPESA" && currency !== "KES") {
      setError("M-Pesa collects Kenyan shillings.");
      return;
    }
    const digits = normalizePhoneDigits(phone, currency);
    if (digits.length < 11) {
      setError("Enter the M-Pesa number, starting with 254.");
      return;
    }
    setBusy(true);
    try {
      await collect(token, digits, selected.code);
      setPhase("prompt");
    } catch (reason: unknown) {
      if (reason instanceof ApiError && reason.code === "QUOTE_EXPIRED") {
        try {
          setQuote(await refreshQuote(token));
        } catch {
          setError("The price expired.");
        }
      } else if (phase === "failed") {
        try {
          await retryCollection(token);
          setPhase("prompt");
        } catch (retry: unknown) {
          setError(retry instanceof Error ? retry.message : "Could not resend the M-Pesa prompt");
        }
      } else {
        setPhase("failed");
        setError(reason instanceof Error ? reason.message : "Could not send the M-Pesa prompt");
      }
    } finally {
      setBusy(false);
    }
  }

  if (phase === "received") {
    return (
      <div className="splash success" role="status">
        <p className="splash-title">Payment received</p>
        <p className="splash-sub">Held in the wallet until delivery</p>
      </div>
    );
  }

  const action = phase === "prompt" ? "Approve the M-Pesa prompt…" : phase === "failed" ? "Resend M-Pesa prompt" : "Pay with M-Pesa";

  return (
    <CloneBoard
      title="Pay with M-Pesa"
      rows={[
        { label: "You pay", value: youPay ? formatMoney(youPay, true) : "…" },
        {
          label: "M-Pesa number",
          value: (
            <>
              <input
                aria-label="M-Pesa number"
                inputMode="tel"
                list="mpesa-suggestions"
                placeholder="2547…"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
              <datalist id="mpesa-suggestions">
                <option value="2547" />
                <option value="2541" />
                <option value="25411" />
              </datalist>
            </>
          ),
        },
        {
          label: "Network",
          value: (
            <select aria-label="Network" value={selected?.display_name ?? ""} onChange={(event) => setNetworkName(event.target.value)}>
              {networks.map((row) => (
                <option key={row.display_name} value={row.display_name} disabled={!row.code}>
                  {row.display_name}
                </option>
              ))}
            </select>
          ),
        },
        { label: "Exporter", value: quote?.exporter_name || "Amina Traders" },
      ]}
      stats={[
        { label: "Invoice total", value: youPay ? formatMoney(youPay) : "—", share: youPay ? "100%" : "—", tone: "light" },
        { label: "Exporter receives", value: exporter ? formatMoney(exporter) : "—", share: share.label, tone: "blue" },
      ]}
      chart={share.ratio}
      totalLabel={phase === "prompt" ? "Check the phone for the M-Pesa prompt" : "STK push"}
      totalValue={youPay ? formatMoney(youPay, true) : "—"}
      actionLabel={action}
      actionDisabled={busy || phase === "prompt"}
      onAction={() => void pay()}
      note={error}
      mark={qr ? <PaymentQr text={qr} /> : null}
      extra={
        onClose ? (
          <button type="button" onClick={onClose}>
            Back
          </button>
        ) : null
      }
    />
  );
}
