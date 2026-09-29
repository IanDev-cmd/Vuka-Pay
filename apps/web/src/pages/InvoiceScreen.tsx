import { useEffect, useState } from "react";
import { ApiError, createInvoice, getCorridors, listPayouts, listTrades, sendInvoice, type CorridorMeta } from "../api";
import { PhoneSheet } from "../components/PhoneSheet";
import { QuoteCard, Rows, type CardFace } from "../components/QuoteCard";
import { placeholderQuote } from "../example";
import { formatMoney, formatRate, heldUntilClock, majorToMinor, normalizePhoneDigits } from "../format";
import { CORRIDOR_NETWORKS, countryForCurrency } from "../networks";
import type { BuyerQuote, NetworkOption } from "../types";

const TABS = [
  { id: "invoice", label: "Invoice" },
  { id: "trades", label: "Trades" },
  { id: "payouts", label: "Payouts" },
];

export function InvoiceScreen({ initialTab = "invoice" }: { initialTab?: "invoice" | "trades" | "payouts" }) {
  const [tab, setTab] = useState(initialTab);
  const [amount, setAmount] = useState("45,000");
  const [currency, setCurrency] = useState<"UGX" | "TZS">("UGX");
  const [live, setLive] = useState<BuyerQuote | null>(null);
  const [corridors, setCorridors] = useState<CorridorMeta[]>([]);
  const [networkName, setNetworkName] = useState("MTN MoMo");
  const [sheet, setSheet] = useState(false);
  const [buyerName, setBuyerName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [trades, setTrades] = useState<{ id: string; state: string }[] | null>(null);
  const [payouts, setPayouts] = useState<{ id: string; status: string }[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const [example] = useState(() => placeholderQuote());
  const shown = live && live.collection_currency === currency ? live : currency === "UGX" && amount.replace(/,/g, "") === "45000" ? example : null;
  const quote = shown;

  useEffect(() => {
    getCorridors()
      .then(setCorridors)
      .catch(() => setCorridors([]));
  }, []);

  useEffect(() => {
    const fallback = CORRIDOR_NETWORKS[currency][0]?.display_name ?? "MTN MoMo";
    setNetworkName(fallback);
    setLive(null);
  }, [currency]);

  useEffect(() => {
    if (tab === "invoice") return;
    let cancelled = false;
    setListError(null);
    const load = tab === "trades" ? listTrades().then((rows) => !cancelled && setTrades(rows)) : listPayouts().then((rows) => !cancelled && setPayouts(rows));
    load.catch((reason: unknown) => {
      if (!cancelled) setListError(reason instanceof Error ? reason.message : "Could not load this list");
    });
    return () => {
      cancelled = true;
    };
  }, [tab]);

  const networks = networksFor(currency, corridors);
  const selected = networks.find((row) => row.display_name === networkName) ?? networks[0];
  const flag = currency === "UGX" ? "UG" : "TZ";

  const top: CardFace = {
    label: "Invoice amount",
    prefix: "KES",
    amount,
    editable: true,
    onAmount: (value) => {
      setAmount(value);
      setLive(null);
    },
    pill: {
      kind: "menu",
      flag,
      label: "Buyer pays in",
      selected: currency,
      options: [
        { id: "UGX", label: "UGX", flag: "UG" },
        { id: "TZS", label: "TZS", flag: "TZ" },
      ],
      onSelect: (id) => {
        if (id === "UGX" || id === "TZS") setCurrency(id);
      },
    },
    subline: "",
    meta: "",
  };

  const bottom: CardFace = {
    label: "Buyer pays",
    amount: quote ? formatMoney(quote.buyer_amount, true) : "—",
    pill: { kind: "static", flag, label: currency },
    subline: quote?.exporter_net ? `You receive ${formatMoney(quote.exporter_net, true)} after fees` : "",
    meta: "",
  };

  const rateText = `1 KES = ${quote?.rate ? formatRate(quote.rate) : "—"} ${currency} · Fees included`;

  async function onConfirm(phone: string) {
    const minor = majorToMinor(amount, "KES");
    if (!minor || minor === "0") {
      setError("Enter the invoice amount in KES.");
      return;
    }
    if (!buyerName.trim()) {
      setError("Enter the buyer name.");
      return;
    }
    if (!selected?.code) {
      setSheet(false);
      setError("This network has no Payaza code from the corridor list yet.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await createInvoice({
        items: [{ description: "Goods", quantity: 1, unit: { amount_minor: minor, currency: "KES" } }],
        buyer: {
          name: buyerName.trim(),
          phone: normalizePhoneDigits(phone, currency),
          country: countryForCurrency(currency),
          network: selected.code,
          currency,
        },
      });
      if (created.quote) setLive(created.quote);
      await sendInvoice(created.id);
      setSheet(false);
    } catch (reason: unknown) {
      setError(reason instanceof ApiError ? reason.message : "Could not send the invoice");
    } finally {
      setBusy(false);
    }
  }

  const panel =
    tab === "trades" ? (
      <Rows
        rows={
          listError
            ? [{ label: "Trades", value: listError }]
            : trades && trades.length > 0
              ? trades.map((row) => ({ label: row.id, value: row.state }))
              : [{ label: "Trades", value: trades ? "—" : "…" }]
        }
      />
    ) : (
      <Rows
        rows={
          listError
            ? [{ label: "Payouts", value: listError }]
            : payouts && payouts.length > 0
              ? payouts.map((row) => ({ label: row.id, value: row.status }))
              : [{ label: "Payouts", value: payouts ? "—" : "…" }]
        }
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
        breakdown={[
          { label: "Goods", value: quote ? formatMoney(quote.fees.goods, true) : kesGoods(amount) },
          { label: "VukaPay fee", value: quote?.fees.vukapay_fee ? formatMoney(quote.fees.vukapay_fee, true) : "—" },
          {
            label: "Payaza processing fee",
            value: quote?.fees.payaza_processing_fee ? formatMoney(quote.fees.payaza_processing_fee, true) : "Recorded on settlement",
          },
          { label: "Spread", value: quote?.fees.spread_bps == null ? "—" : `${quote.fees.spread_bps} bps` },
          { label: "Price held until", value: quote?.expires_at ? heldUntilClock(quote.expires_at) : "—" },
        ]}
        actionLabel="Send invoice"
        actionBusy={busy}
        onAction={() => {
          setError(null);
          setSheet(true);
        }}
        error={error}
        panel={panel}
      />
      {sheet ? (
        <PhoneSheet
          title="Send invoice"
          hint="The buyer gets a pay link for this amount."
          currency={currency}
          flag={flag}
          networks={networks}
          networkId={selected?.display_name ?? ""}
          onNetwork={setNetworkName}
          showNetwork
          name={{ value: buyerName, onChange: setBuyerName }}
          onClose={() => setSheet(false)}
          onConfirm={(phone) => void onConfirm(phone)}
        />
      ) : null}
    </>
  );
}

function networksFor(currency: "UGX" | "TZS", corridors: CorridorMeta[]): NetworkOption[] {
  const fromApi = corridors.find((row) => row.currency === currency)?.networks ?? [];
  if (fromApi.length > 0) return fromApi;
  return CORRIDOR_NETWORKS[currency];
}

function kesGoods(amount: string): string {
  const minor = majorToMinor(amount, "KES");
  if (!minor) return "—";
  return formatMoney({ amount_minor: minor, currency: "KES" }, true);
}
