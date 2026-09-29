export interface TradeRecordInput {
  id: string;
  terminalState: "PAID_OUT" | "REFUNDED" | "CANCELLED" | "EXPIRED" | "PAYMENT_FAILED";
  corridor: string;
  onTime: boolean | null;
  disputed: boolean;
  disputeOutcome: "RELEASE" | "REFUND" | "SPLIT" | null;
  counterpartyKey: string;
  completedAt: Date;
  amountKesMinor: bigint;
}

export interface CreditScoreResult {
  status: "insufficient_history" | "scored";
  score: number | null;
  reasonCodes: string[];
  sampleSize: number;
  disclaimer: string;
}

const DISCLAIMER =
  "This is a transparent summary of this exporter's VukaPay trade records. It is not a credit approval, a lending decision, or a bureau-grade score.";

export function scoreTradeRecords(records: TradeRecordInput[], minRecords: number): CreditScoreResult {
  if (records.length < minRecords) {
    return {
      status: "insufficient_history",
      score: null,
      reasonCodes: ["INSUFFICIENT_HISTORY"],
      sampleSize: records.length,
      disclaimer: DISCLAIMER,
    };
  }
  const completed = records.filter((row) => row.terminalState === "PAID_OUT");
  const disputed = records.filter((row) => row.disputed);
  const lostDisputes = disputed.filter((row) => row.disputeOutcome === "REFUND");
  const cancelled = records.filter((row) => row.terminalState === "CANCELLED" || row.terminalState === "EXPIRED");
  const onTimeKnown = completed.filter((row) => row.onTime !== null);
  const onTime = onTimeKnown.filter((row) => row.onTime).length;
  const counterparties = new Set(records.map((row) => row.counterpartyKey)).size;
  const completionRate = completed.length / records.length;
  const onTimeRate = onTimeKnown.length === 0 ? 0.5 : onTime / onTimeKnown.length;
  const disputeRate = disputed.length / records.length;
  const cancelRate = cancelled.length / records.length;
  const diversity = Math.min(counterparties / 5, 1);
  const raw =
    completionRate * 40 + onTimeRate * 25 + (1 - disputeRate) * 15 + (1 - cancelRate) * 10 + diversity * 10;
  const penalty = lostDisputes.length * 3;
  const score = Math.max(0, Math.min(100, Math.round(raw - penalty)));
  const reasonCodes: string[] = [];
  if (completionRate >= 0.8) reasonCodes.push("HIGH_COMPLETION");
  else reasonCodes.push("LOW_COMPLETION");
  if (onTimeRate >= 0.8) reasonCodes.push("ON_TIME_DELIVERY");
  else reasonCodes.push("LATE_DELIVERY");
  if (disputeRate > 0.2) reasonCodes.push("ELEVATED_DISPUTE_RATE");
  if (lostDisputes.length > 0) reasonCodes.push("DISPUTE_REFUNDED");
  if (cancelRate > 0.3) reasonCodes.push("HIGH_CANCEL_OR_EXPIRE");
  if (counterparties >= 3) reasonCodes.push("COUNTERPARTY_DIVERSITY");
  else reasonCodes.push("LOW_COUNTERPARTY_DIVERSITY");
  const newest = records.reduce((max, row) => (row.completedAt > max ? row.completedAt : max), records[0]!.completedAt);
  const ageDays = (Date.now() - newest.getTime()) / 86_400_000;
  if (ageDays > 180) reasonCodes.push("STALE_ACTIVITY");
  else reasonCodes.push("RECENT_ACTIVITY");
  return { status: "scored", score, reasonCodes, sampleSize: records.length, disclaimer: DISCLAIMER };
}
