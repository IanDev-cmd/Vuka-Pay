import { useEffect, useRef, useState } from "react";
import { ApiError, getBalance, listPayouts, type PayoutListItem, type WalletBalance } from "../api";
import { formatMoney } from "../format";
import { navigate } from "../nav";
import type { Money } from "../types";
import "../wallet.css";

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

  return (
    <div className="wallet-page">
      <div className="wallet-shell">
        <h1 className="wallet-title">Wallet</h1>
        <p className="wallet-sub">We hold your money safely until the goods arrive.</p>
        {receivedNote ? <p className="wallet-sub">{receivedNote}</p> : null}
        {error ? <p className="wallet-error">{error}</p> : null}

        <div className="wallet-grid">
          <div className="tx-list">
            {rows.map((row) => (
              <button
                key={row.id}
                type="button"
                className={row.id === selected?.id ? "tx-row selected" : "tx-row"}
                onClick={() => setSelectedId(row.id)}
              >
                <span className="tx-radio" aria-hidden="true">
                  {row.id === selected?.id ? (
                    <svg width="12" height="12" viewBox="0 0 12 12">
                      <path d="M2.2 6.2 L4.8 8.8 L9.8 3.4" fill="none" stroke="#5823ef" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : null}
                </span>
                <span className="tx-copy">
                  <strong>{row.label}</strong>
                  {row.badge ? <span className="tx-badge">{row.badge}</span> : null}
                </span>
                <span className="tx-amount">
                  {row.amount ? formatMoney(row.amount) : "—"}
                  {row.amount ? <small>{row.amount.currency}</small> : null}
                </span>
              </button>
            ))}
          </div>

          <div className="balance-wrap">
            <article className="balance-card">
              <p className="balance-kicker">{selected?.label ?? "In hold"}</p>
              <p className={selected?.amount ? "balance-total" : "balance-total empty"}>
                {selected?.amount ? (
                  <>
                    <span>{selected.amount.currency}</span>
                    {formatMoney(selected.amount)}
                  </>
                ) : (
                  "—"
                )}
              </p>
              <div className="balance-stats">
                <div>
                  <span>In hold</span>
                  <strong>{balance.in_hold ? formatMoney(balance.in_hold, true) : "—"}</strong>
                </div>
                <div>
                  <span>Paid out</span>
                  <strong>{balance.paid_out ? formatMoney(balance.paid_out, true) : "—"}</strong>
                </div>
                <div>
                  <span>Pending payout</span>
                  <strong>{balance.pending_payout ? formatMoney(balance.pending_payout, true) : "—"}</strong>
                </div>
              </div>
              <button
                type="button"
                className="wallet-action"
                aria-disabled={selected?.tradeId ? undefined : true}
                onClick={() => {
                  if (selected?.tradeId) navigate(`/trades/${selected.tradeId}`);
                }}
              >
                Open trade
              </button>
            </article>
          </div>
        </div>
      </div>
    </div>
  );
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
