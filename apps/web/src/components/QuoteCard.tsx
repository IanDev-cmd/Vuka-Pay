import { useEffect, useId, useState, type ReactNode } from "react";
import { Avatar, type PartyFace } from "./Avatar";
import { Chevron, DownArrow, Flag, type FlagCode } from "./Flags";

export interface TabItem {
  id: string;
  label: string;
}

export function QuoteCard({
  tabs,
  activeTab,
  onTab,
  top,
  bottom,
  rateText,
  breakdown,
  actionLabel,
  actionBusy,
  actionDisabled,
  onAction,
  footnote,
  error,
  panel,
  embedded,
}: {
  tabs: TabItem[];
  activeTab: string;
  onTab: (id: string) => void;
  top: CardFace;
  bottom: CardFace;
  rateText: string;
  breakdown: { label: string; value: string }[];
  actionLabel: string;
  actionBusy?: boolean;
  actionDisabled?: boolean;
  onAction: () => void;
  footnote?: string;
  error?: string | null;
  panel?: ReactNode;
  embedded?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <main className={embedded ? "stage stage-embedded" : "stage"}>
      <div className="widget">
        <div className="tabs" role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className="tab"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => onTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {activeTab === tabs[0]?.id ? (
          <>
            <div className="stack">
              <Face card={top} />
              <div className="seam" aria-hidden="true">
                <div className="knob">
                  <DownArrow />
                </div>
              </div>
              <Face card={bottom} />
            </div>
            <button type="button" className="rate" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
              <span>{rateText}</span>
              <Chevron />
            </button>
            {open ? (
              <div className="breakdown">
                {breakdown.map((row) => (
                  <div key={row.label}>
                    <span>{row.label}</span>
                    <strong>{row.value}</strong>
                  </div>
                ))}
              </div>
            ) : null}
            <button type="button" className="cta" onClick={onAction} disabled={actionBusy || actionDisabled}>
              <span className="cta-label">
                {actionBusy ? <span className="spinner" aria-hidden="true" /> : null}
                {actionLabel}
              </span>
            </button>
            {footnote ? <p className="footnote">{footnote}</p> : null}
            {error ? <p className="footnote error">{error}</p> : null}
          </>
        ) : (
          panel
        )}
      </div>
    </main>
  );
}

export interface CardFace {
  label: string;
  amount: string;
  prefix?: string;
  editable?: boolean;
  onAmount?: (value: string) => void;
  pill: PillModel;
  subline: string;
  sublineAvatar?: PartyFace;
  meta: string;
}

type PillOption = { id: string; label: string; flag?: FlagCode };

type PillModel =
  | { kind: "static"; flag: FlagCode; label: string }
  | { kind: "menu"; flag: FlagCode; label: string; options: PillOption[]; selected: string; onSelect: (id: string) => void };

function Face({ card }: { card: CardFace }) {
  return (
    <article className="card">
      <p className="side-label">{card.label}</p>
      <div className="amount-row">
        {card.editable ? (
          <div className="amount-prefix">
            {card.prefix ? <span className="amount">{card.prefix}</span> : null}
            <input
              className="amount-input"
              inputMode="decimal"
              aria-label={card.label}
              value={card.amount}
              onChange={(event) => card.onAmount?.(event.target.value)}
            />
          </div>
        ) : (
          <p className="amount">{card.amount}</p>
        )}
        <Pill pill={card.pill} />
      </div>
      <div className="meta-row">
        <span className="subline-with-avatar">
          {card.sublineAvatar ? <Avatar party={card.sublineAvatar} size={18} /> : null}
          {card.subline}
        </span>
        <span>{card.meta}</span>
      </div>
    </article>
  );
}

function Pill({ pill }: { pill: PillModel }) {
  const menuId = useId();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function close(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const root = document.getElementById(menuId);
      if (root && !root.contains(target)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open, menuId]);

  if (pill.kind === "static") {
    return (
      <div className="pill">
        <div className="pill-static">
          <Flag code={pill.flag} />
          <span>{pill.label}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="pill" id={menuId}>
      <button type="button" className="pill-btn" aria-expanded={open} aria-haspopup="listbox" onClick={() => setOpen((value) => !value)}>
        <Flag code={pill.flag} />
        <span>{pill.label}</span>
        <Chevron />
      </button>
      {open ? (
        <ul className="menu" role="listbox">
          {pill.options.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                role="option"
                aria-selected={option.id === pill.selected}
                onClick={() => {
                  pill.onSelect(option.id);
                  setOpen(false);
                }}
              >
                <Flag code={option.flag ?? pill.flag} size={18} />
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function Rows({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <article className="card">
      {rows.map((row) => (
        <div className="plain-row" key={row.label}>
          <span>{row.label}</span>
          <strong>{row.value || "—"}</strong>
        </div>
      ))}
    </article>
  );
}
