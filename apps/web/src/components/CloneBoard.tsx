import type { ReactNode } from "react";
import { navigate } from "../nav";

export interface CloneRow {
  label: string;
  value: ReactNode;
  onSelect?: () => void;
  selected?: boolean;
}

export interface CloneStat {
  label: string;
  value: string;
  share: string;
  tone: "light" | "blue";
}

export function CloneBoard({
  title,
  rows,
  stats,
  chart,
  totalLabel,
  totalValue,
  actionLabel,
  onAction,
  actionDisabled,
  note,
  noteTone,
  extra,
  mark,
}: {
  title: string;
  rows: CloneRow[];
  stats: CloneStat[];
  chart: number;
  totalLabel: string;
  totalValue: string;
  actionLabel: string;
  onAction: () => void;
  actionDisabled?: boolean;
  note?: string | null;
  noteTone?: "error" | "ok";
  extra?: ReactNode;
  mark?: ReactNode;
}) {
  const blue = Math.max(0, Math.min(100, chart));
  const here = window.location.pathname;
  const sessionOn = here === "/" || here.startsWith("/pay/") || here.startsWith("/trades/") || here === "/invoice";
  return (
    <div className="clone-page">
      <div className="clone-sky" aria-hidden="true" />
      <div className="clone-top">
        <p className="clone-brand">VukaPay</p>
        <nav className="clone-menu" aria-label="Pages">
          <button type="button" className={sessionOn ? "on" : undefined} onClick={() => navigate("/")}>Session</button>
          <button type="button" className={here === "/trades" ? "on" : undefined} onClick={() => navigate("/trades")}>Trades</button>
          <button type="button" className={here === "/wallet" ? "on" : undefined} onClick={() => navigate("/wallet")}>Wallet</button>
          <button type="button" className={here === "/install" ? "on" : undefined} onClick={() => navigate("/install")}>Install</button>
        </nav>
      </div>
      <section className="clone-card" aria-label={title}>
        <div className="clone-form">
          <h1>{title}</h1>
          {rows.map((row) => {
            const body = (
              <>
                <span>{row.label}</span>
                <strong>{row.value}</strong>
              </>
            );
            return row.onSelect ? (
              <button key={row.label} type="button" className={row.selected ? "clone-row on" : "clone-row"} onClick={row.onSelect}>
                {body}
              </button>
            ) : (
              <div key={row.label} className="clone-row">
                {body}
              </div>
            );
          })}
          {note ? <p className={noteTone === "ok" ? "clone-note ok" : "clone-note"}>{note}</p> : null}
        </div>
        <div className="clone-side">
          <div className="clone-navy">
            <div className="clone-stats">
              {stats.map((stat) => (
                <div key={stat.label} className="clone-stat">
                  <i className={stat.tone} />
                  <div>
                    <p>{stat.label}</p>
                    <b>
                      {stat.value} <small>({stat.share})</small>
                    </b>
                  </div>
                </div>
              ))}
            </div>
            {mark ?? (
              <svg className="clone-donut" viewBox="0 0 42 42" aria-hidden="true">
                <circle cx="21" cy="21" r="14" />
                <circle cx="21" cy="21" r="14" pathLength={100} strokeDasharray={`${blue} ${100 - blue}`} />
              </svg>
            )}
          </div>
          <div className="clone-pay">
            <p>{totalLabel}</p>
            <strong>{totalValue}</strong>
            <button type="button" disabled={actionDisabled} onClick={onAction}>
              {actionLabel}
            </button>
            {extra}
          </div>
        </div>
      </section>
    </div>
  );
}

export function shareOf(part: string | null | undefined, whole: string | null | undefined): { ratio: number; label: string } {
  if (!part || !whole || !/^\d+$/.test(part) || !/^\d+$/.test(whole) || whole === "0") {
    return { ratio: 50, label: "—" };
  }
  const ratio = Number((BigInt(part) * 1000n) / BigInt(whole)) / 10;
  const clamped = Math.max(0, Math.min(100, ratio));
  return { ratio: clamped, label: `${clamped.toFixed(1)}%` };
}
