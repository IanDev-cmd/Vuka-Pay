import { useEffect, useState } from "react";
import { listTrades } from "../api";
import { DEMO_TRADES } from "../example";
import { CloneBoard, shareOf } from "../components/CloneBoard";
import { navigate } from "../nav";

export function TradesBoard() {
  const [rows, setRows] = useState<{ id: string; state: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listTrades()
      .then((next) => {
        if (cancelled) return;
        setRows(next);
        setError(null);
      })
      .catch(() => {
        if (cancelled) return;
        setRows(DEMO_TRADES.map((row) => ({ id: row.id, state: row.state })));
        setError("Demo trades. These are not on the ledger.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const list = rows ?? [];
  const slots = [0, 1, 2, 3].map((index) => list[index] ?? null);
  const current = list[selected] ?? null;
  const openShare = shareOf(String(list.filter((row) => row.state !== "PAID_OUT" && row.state !== "REFUNDED").length), String(Math.max(list.length, 1)));

  return (
    <CloneBoard
      title="Trades"
      rows={slots.map((row, index) => ({
        label: row ? row.state : "Trade",
        value: row ? row.id : rows === null ? "…" : "—",
        selected: index === selected && Boolean(row),
        onSelect: row ? () => setSelected(index) : undefined,
      }))}
      stats={[
        { label: "Open trades", value: rows === null ? "…" : String(list.length), share: openShare.label, tone: "light" },
        { label: "Selected", value: current?.state ?? "—", share: current ? `${selected + 1} of ${list.length}` : "—", tone: "blue" },
      ]}
      chart={list.length === 0 ? 0 : openShare.ratio}
      totalLabel="Selected trade"
      totalValue={current?.id ?? "—"}
      actionLabel="Open trade"
      actionDisabled={!current}
      onAction={() => {
        if (current) navigate(`/trades/${current.id}`);
      }}
      note={error}
    />
  );
}
