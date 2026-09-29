import { useEffect, useMemo, useState } from "react";
import {
  ApiError,
  collect,
  getPay,
  getPayStatus,
  refreshQuote,
  retryCollection,
} from "../api";
import type { PartyFace } from "../components/Avatar";
import { QuoteCard, Rows, type CardFace } from "../components/QuoteCard";
import { PhoneSheet } from "../components/PhoneSheet";
import { placeholderQuote } from "../example";
import { countdownLabel, formatMoney, formatRate, heldUntilClock } from "../format";
import { CORRIDOR_NETWORKS, countryForCurrency } from "../networks";
import type { BuyerQuote, NetworkOption, PayStatus } from "../types";

const FUNDED = new Set(["FUNDED", "SHIPPED", "DELIVERY_CLAIMED", "DISPUTED", "RELEASE_PENDING", "PAYOUT_FAILED", "PAID_OUT"]);

type Phase = "ready" | "prompt" | "received" | "expired";

const TABS = [
  { id: "pay", label: "Pay" },
  { id: "invoice", label: "Invoice" },
  { id: "status", label: "Status" },
];

export function BuyerScreen({
  token,
  embedded = false,
  party = null,
}: {
  token: string | null;
  embedded?: boolean;
  party?: PartyFace | null;
}) {
  const preview = placeholderQuote();
  const [quote, setQuote] = useState<BuyerQuote | null>(token ? null : preview);
  const [networkName, setNetworkName] = useState(preview.networks[0]?.display_name ?? "MTN MoMo");
  const [phase, setPhase] = useState<Phase>("ready");
  const [sheet, setSheet] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<PayStatus | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [tab, setTab] = useState("pay");
  const [paymentFailed, setPaymentFailed] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getPay(token)
      .then((next) => {
        if (cancelled) return;
        setQuote(next);
        const first = (next.networks[0] ?? CORRIDOR_NETWORKS[next.collection_currency][0])?.display_name;
        if (first) setNetworkName(first);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load this pay link");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const countdown = quote?.expires_at ? countdownLabel(quote.expires_at, now) : { text: "—", expired: false };
  const quoteExpired = countdown.expired && Boolean(quote?.expires_at);

  useEffect(() => {
    if (phase === "received") return;
    if (quoteExpired && phase !== "prompt") setPhase("expired");
  }, [quoteExpired, phase]);

  useEffect(() => {
    if (!token || phase !== "prompt") return;
    let cancelled = false;
    async function poll() {
      try {
        const next = await getPayStatus(token as string);
        if (cancelled) return;
        setStatus(next);
        const funded =
          next.collection_status === "COMPLETED" || (next.trade_state != null && FUNDED.has(next.trade_state));
        const failed =
          next.collection_status === "FAILED" ||
          next.collection_status === "EXPIRED" ||
          next.trade_state === "PAYMENT_FAILED" ||
          next.trade_state === "EXPIRED";
        if (funded) setPhase("received");
        else if (failed) {
          setPaymentFailed(true);
          setPhase("expired");
        }
      } catch (reason: unknown) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not read payment status");
      }
    }
    void poll();
    const timer = window.setInterval(() => void poll(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [token, phase]);

  const networks = useMemo(() => networksFor(quote), [quote]);
  const selected = networks.find((row) => row.display_name === networkName) ?? networks[0];
  const currency = quote?.collection_currency ?? "UGX";
  const flag = currency === "UGX" ? "UG" : "TZ";

  const top: CardFace = {
    label: "You pay",
    amount: quote ? formatMoney(quote.buyer_amount) : "—",
    pill: {
      kind: "menu",
      flag,
      label: selected?.display_name ?? "MTN MoMo",
      selected: selected?.display_name ?? "",
      options: networks.map((row) => ({ id: row.display_name, label: row.display_name })),
      onSelect: setNetworkName,
    },
    subline: "",
    meta: `Rate locked · ${countdown.text}`,
  };

  const bottom: CardFace = {
    label: "Exporter receives",
    amount: quote ? formatMoney(quote.exporter_receives, true) : "—",
    pill: { kind: "static", flag: "KE", label: "KES · M-Pesa" },
    subline: quote ? `Invoice #${quote.invoice_number} · ${party?.display_name || quote.exporter_name}` : "",
    sublineAvatar: party ?? undefined,
    meta: "Paid out on verified delivery",
  };

  const rateText = `1 KES = ${quote?.rate ? formatRate(quote.rate) : "—"} ${currency} · Fees included`;
  const actionLabel =
    phase === "prompt"
      ? "Approve on your phone…"
      : phase === "received"
        ? "Payment received. Funds held until delivery."
        : phase === "expired"
          ? "Price expired. Get new price"
          : `Pay with ${selected?.display_name ?? "MTN MoMo"}`;

  async function onAction() {
    setError(null);
    if (phase === "received" || phase === "prompt") return;
    if (phase === "expired") {
      if (!token) {
        setQuote(placeholderQuote());
        setPhase("ready");
        setPaymentFailed(false);
        return;
      }
      try {
        if (paymentFailed && !quoteExpired) {
          await retryCollection(token);
          setPhase("prompt");
        } else {
          const next = await refreshQuote(token);
          setQuote(next);
          setPhase("ready");
          setPaymentFailed(false);
        }
      } catch (reason: unknown) {
        setError(reason instanceof ApiError ? reason.message : "Could not refresh the price");
      }
      return;
    }
    setSheet(true);
  }

  async function onConfirm(phone: string) {
    setSheet(false);
    if (!token) {
      setError("This screen is the quote layout. Open the buyer link to start the mobile-money prompt.");
      return;
    }
    if (!selected?.code) {
      setError("This network has no Payaza code on the pay link yet.");
      return;
    }
    try {
      await collect(token, phone, selected.code);
      setPhase("prompt");
      setError(null);
    } catch (reason: unknown) {
      if (reason instanceof ApiError && reason.code === "QUOTE_EXPIRED") setPhase("expired");
      setError(reason instanceof Error ? reason.message : "Could not start the payment");
    }
  }

  const panel =
    tab === "invoice" ? (
      <Rows
        rows={[
          { label: "Invoice", value: quote ? `#${quote.invoice_number}` : "—" },
          { label: "Exporter", value: quote?.exporter_name ?? "—" },
          { label: "You pay", value: quote ? formatMoney(quote.buyer_amount, true) : "—" },
          { label: "Exporter receives", value: quote ? formatMoney(quote.exporter_receives, true) : "—" },
        ]}
      />
    ) : (
      <Rows
        rows={[
          { label: "Collection", value: status?.collection_status ?? "—" },
          { label: "Trade", value: status?.trade_state ?? "—" },
        ]}
      />
    );

  return (
    <>
      <QuoteCard
        tabs={TABS}
        activeTab={tab}
        onTab={setTab}
        top={top}
        bottom={bottom}
        rateText={rateText}
        breakdown={[{ label: "Price held until", value: quote?.expires_at ? heldUntilClock(quote.expires_at) : "—" }]}
        actionLabel={actionLabel}
        actionBusy={phase === "prompt"}
        actionDisabled={phase === "received"}
        onAction={() => void onAction()}
        footnote="We hold your money safely until the goods arrive."
        error={error}
        panel={panel}
        embedded={embedded}
      />
      {sheet && selected ? (
        <PhoneSheet
          title={`Enter your ${selected.display_name} number`}
          hint={`${countryForCurrency(currency) === "UG" ? "Uganda" : "Tanzania"} · ${prefixHint(currency)}`}
          currency={currency}
          flag={flag}
          networks={networks}
          networkId={selected.display_name}
          onNetwork={setNetworkName}
          showNetwork={false}
          onClose={() => setSheet(false)}
          onConfirm={(phone) => void onConfirm(phone)}
        />
      ) : null}
    </>
  );
}

function networksFor(quote: BuyerQuote | null): NetworkOption[] {
  if (quote && quote.networks.length > 0) return quote.networks;
  return CORRIDOR_NETWORKS[quote?.collection_currency ?? "UGX"];
}

function prefixHint(currency: "UGX" | "TZS"): string {
  return currency === "UGX" ? "numbers start with 256" : "numbers start with 255";
}

