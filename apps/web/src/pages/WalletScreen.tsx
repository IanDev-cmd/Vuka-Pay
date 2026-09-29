import { useEffect, useRef, useState } from "react";
import { ApiError, getBalance, listPayouts, type PayoutListItem, type WalletBalance } from "../api";
import { CloneBoard, shareOf } from "../components/CloneBoard";
import { formatMoney } from "../format";
import { navigate } from "../nav";
import type { Money } from "../types";

interface WalletRow {
  id: string;
  label: string;
  badge: string | null;
  amount: Money | null;
  tradeId: string | null;
}

const EMPTY_BALANCE: WalletBalance = { in_hold: null, paid_out: null, pending_payout: null };

export function WalletScreen() {
  const [balance, setBalance] = useState<WalletBalance>(EMPTY_BALANCE);
  const [payouts, setPayouts] = useState<PayoutListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [receivedNote, setReceivedNote] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState("in_hold");
  const previousHold = useRef<string | null>(null);

  useEffect(() => {
    if (sessionStorage.getItem("vukapay-received") === "1") {
      setReceivedNote("M-Pesa payment received. It is in hold until delivery.");
      sessionStorage.removeItem("vukapay-received");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [nextBalance, nextPayouts] = await Promise.all([getBalance(), listPayouts()]);
        if (cancelled) return;
        const nextHold = nextBalance.in_hold?.amount_minor ?? "0";
        const prior = previousHold.current;
        if (prior !== null && BigInt(nextHold) > BigInt(prior) && nextBalance.in_hold) {
          setReceivedNote(`M-Pesa payment received. ${formatMoney(nextBalance.in_hold, true)} is in hold.`);
          setSelectedId("in_hold");
        }
        previousHold.current = nextHold;
        setBalance(nextBalance);
        setPayouts(nextPayouts);
        setError(null);
      } catch (reason: unknown) {
        if (cancelled) return;
        const message = reason instanceof ApiError && reason.status < 500 ? reason.message : "Could not load the wallet";
        setError(message);
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const rows = rowsFrom(balance, payouts);
  const selected = rows.find((row) => row.id === selectedId) ?? rows[0];

  const shown = rows.slice(0, 4);
  while (shown.length < 4) shown.push({ id: `empty-${shown.length}`, label: "Balance", badge: null, amount: null, tradeId: null });
  const held = shareOf(balance.in_hold?.amount_minor, sumMinors([balance.in_hold, balance.paid_out, balance.pending_payout]));
  const selectedShare = shareOf(selected?.amount?.amount_minor, sumMinors([balance.in_hold, balance.paid_out, balance.pending_payout]));

  return (
    <CloneBoard
      title="Wallet"
      rows={shown.map((row) => ({
        label: row.badge ? `${row.label} · ${row.badge}` : row.label,
        value: row.amount ? formatMoney(row.amount, true) : "—",
        selected: row.id === selected?.id,
        onSelect: () => setSelectedId(row.id),
      }))}
      stats={[
        { label: "In hold", value: balance.in_hold ? formatMoney(balance.in_hold) : "—", share: held.label, tone: "light" },
        { label: selected?.label ?? "Paid out", value: selected?.amount ? formatMoney(selected.amount) : "—", share: selectedShare.label, tone: "blue" },
      ]}
      chart={selectedShare.ratio}
      totalLabel="We hold your money safely until the goods arrive."
      totalValue={selected?.amount ? formatMoney(selected.amount, true) : "—"}
      actionLabel="Open trade"
      actionDisabled={!selected?.tradeId}
      onAction={() => {
        if (selected?.tradeId) navigate(`/trades/${selected.tradeId}`);
      }}
      note={receivedNote ?? error}
      noteTone={receivedNote ? "ok" : "error"}
    />
  );
}

function sumMinors(amounts: Array<Money | null>): string {
  let total = 0n;
  for (const amount of amounts) {
    if (amount && /^\d+$/.test(amount.amount_minor)) total += BigInt(amount.amount_minor);
  }
  return total.toString();
}

function rowsFrom(balance: WalletBalance, payouts: PayoutListItem[]): WalletRow[] {
  const buckets: WalletRow[] = [
    { id: "in_hold", label: "In hold", badge: null, amount: balance.in_hold, tradeId: null },
    { id: "paid_out", label: "Paid out", badge: null, amount: balance.paid_out, tradeId: null },
    { id: "pending_payout", label: "Pending payout", badge: null, amount: balance.pending_payout, tradeId: null },
  ];
  const transactions: WalletRow[] = payouts.map((row) => ({
    id: row.id,
    label: row.transaction_reference || row.id,
    badge: row.status || null,
    amount: row.amount,
    tradeId: row.trade_id,
  }));
  return [...buckets, ...transactions];
}
