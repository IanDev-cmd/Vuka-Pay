import type { Currency } from "./money.js";

export const LEDGER_ACCOUNTS = [
  "BUYER_CLEARING",
  "VK_HOLD",
  "FX_CLEARING",
  "EXPORTER_PAYABLE",
  "FEE_REVENUE",
  "PROCESSOR_FEES",
  "REFUNDS_PAYABLE",
] as const;

export type LedgerAccount = (typeof LEDGER_ACCOUNTS)[number];

export interface JournalLine {
  account: LedgerAccount;
  currency: Currency;
  debitMinor: bigint;
  creditMinor: bigint;
}

export interface Journal {
  kind: string;
  tradeId?: string;
  lines: JournalLine[];
}

export class UnbalancedJournalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnbalancedJournalError";
  }
}

export function line(
  account: LedgerAccount,
  currency: Currency,
  side: "debit" | "credit",
  amountMinor: bigint,
): JournalLine {
  if (amountMinor < 0n) throw new Error("journal amounts must be non-negative");
  return {
    account,
    currency,
    debitMinor: side === "debit" ? amountMinor : 0n,
    creditMinor: side === "credit" ? amountMinor : 0n,
  };
}

export function assertBalanced(lines: JournalLine[]): void {
  const totals = new Map<string, { debit: bigint; credit: bigint }>();
  for (const entry of lines) {
    if (entry.debitMinor < 0n || entry.creditMinor < 0n) {
      throw new UnbalancedJournalError("negative amount");
    }
    if (entry.debitMinor > 0n && entry.creditMinor > 0n) {
      throw new UnbalancedJournalError("line is both debit and credit");
    }
    const bucket = totals.get(entry.currency) ?? { debit: 0n, credit: 0n };
    bucket.debit += entry.debitMinor;
    bucket.credit += entry.creditMinor;
    totals.set(entry.currency, bucket);
  }
  for (const [currency, bucket] of totals) {
    if (bucket.debit !== bucket.credit) {
      throw new UnbalancedJournalError(
        `${currency} debits ${bucket.debit} != credits ${bucket.credit}`,
      );
    }
  }
}

export function journal(kind: string, lines: JournalLine[], tradeId?: string): Journal {
  const kept = lines.filter((entry) => entry.debitMinor !== 0n || entry.creditMinor !== 0n);
  assertBalanced(kept);
  return tradeId ? { kind, tradeId, lines: kept } : { kind, lines: kept };
}

/**
 * Gross collection into the Payaza balance, earmarked to VK_HOLD.
 * Processor fee reduces BUYER_CLEARING (the Payaza mirror) and is an expense.
 * BUYER_CLEARING net is what reconcile() compares to Payaza accountBalance.
 */
/**
 * Assumption until Payaza confirms balance math (see OPEN_QUESTIONS):
 * `amount_received` is the gross amount credited, and `transaction_fee` is charged
 * against the merchant balance on top of that credit. Hold + queued refund = gross.
 */
export function journalCollection(input: {
  currency: Currency;
  amountReceivedMinor: bigint;
  feeMinor: bigint;
  holdMinor: bigint;
  refundMinor: bigint;
  tradeId: string;
}): Journal {
  if (input.holdMinor + input.refundMinor !== input.amountReceivedMinor) {
    throw new UnbalancedJournalError("hold + refund must equal amount received");
  }
  const lines: JournalLine[] = [
    line("BUYER_CLEARING", input.currency, "debit", input.amountReceivedMinor),
    line("VK_HOLD", input.currency, "credit", input.holdMinor),
    line("REFUNDS_PAYABLE", input.currency, "credit", input.refundMinor),
  ];
  if (input.feeMinor > 0n) {
    lines.push(line("PROCESSOR_FEES", input.currency, "debit", input.feeMinor));
    lines.push(line("BUYER_CLEARING", input.currency, "credit", input.feeMinor));
  }
  return journal("COLLECTION", lines, input.tradeId);
}

/** KES obligation booked at funding. Cash stays in the collection currency until a real conversion. */
export function journalKesObligation(input: {
  exporterNetMinor: bigint;
  feeMinor: bigint;
  tradeId: string;
}): Journal {
  const exposure = input.exporterNetMinor + input.feeMinor;
  return journal(
    "KES_OBLIGATION",
    [
      line("FX_CLEARING", "KES", "debit", exposure),
      line("EXPORTER_PAYABLE", "KES", "credit", input.exporterNetMinor),
      line("FEE_REVENUE", "KES", "credit", input.feeMinor),
    ],
    input.tradeId,
  );
}

export function journalPayout(input: { amountMinor: bigint; feeMinor: bigint; tradeId: string }): Journal {
  const lines: JournalLine[] = [
    line("EXPORTER_PAYABLE", "KES", "debit", input.amountMinor),
    line("BUYER_CLEARING", "KES", "credit", input.amountMinor),
  ];
  if (input.feeMinor > 0n) {
    lines.push(line("PROCESSOR_FEES", "KES", "debit", input.feeMinor));
    lines.push(line("BUYER_CLEARING", "KES", "credit", input.feeMinor));
  }
  return journal("PAYOUT", lines, input.tradeId);
}

export function journalRefundPayout(input: {
  currency: Currency;
  amountMinor: bigint;
  feeMinor: bigint;
  tradeId: string;
  reverseKesObligation?: { exporterNetMinor: bigint; feeMinor: bigint };
}): Journal {
  const lines: JournalLine[] = [
    line("VK_HOLD", input.currency, "debit", input.amountMinor),
    line("BUYER_CLEARING", input.currency, "credit", input.amountMinor),
  ];
  if (input.feeMinor > 0n) {
    lines.push(line("PROCESSOR_FEES", input.currency, "debit", input.feeMinor));
    lines.push(line("BUYER_CLEARING", input.currency, "credit", input.feeMinor));
  }
  if (input.reverseKesObligation) {
    lines.push(line("EXPORTER_PAYABLE", "KES", "debit", input.reverseKesObligation.exporterNetMinor));
    lines.push(line("FEE_REVENUE", "KES", "debit", input.reverseKesObligation.feeMinor));
    lines.push(
      line(
        "FX_CLEARING",
        "KES",
        "credit",
        input.reverseKesObligation.exporterNetMinor + input.reverseKesObligation.feeMinor,
      ),
    );
  }
  return journal("REFUND_PAYOUT", lines, input.tradeId);
}

/**
 * Real conversion performed outside VukaPay and recorded by an admin with evidence.
 * Each currency balances on its own.
 */
export function journalTreasuryConversion(input: {
  sellCurrency: Currency;
  sellMinor: bigint;
  buyCurrency: Currency;
  buyMinor: bigint;
  releaseHold: boolean;
}): Journal {
  if (input.sellCurrency === input.buyCurrency) {
    throw new Error("treasury conversion must cross currencies");
  }
  const lines: JournalLine[] = [];
  if (input.releaseHold) {
    lines.push(line("VK_HOLD", input.sellCurrency, "debit", input.sellMinor));
  } else {
    lines.push(line("FX_CLEARING", input.sellCurrency, "debit", input.sellMinor));
  }
  lines.push(line("BUYER_CLEARING", input.sellCurrency, "credit", input.sellMinor));
  lines.push(line("BUYER_CLEARING", input.buyCurrency, "debit", input.buyMinor));
  lines.push(line("FX_CLEARING", input.buyCurrency, "credit", input.buyMinor));
  return journal("TREASURY_CONVERSION", lines);
}

export interface AccountBalance {
  account: LedgerAccount;
  currency: Currency;
  debitMinor: bigint;
  creditMinor: bigint;
}

export function netBalance(entry: AccountBalance): bigint {
  return entry.debitMinor - entry.creditMinor;
}

export interface DriftFlag {
  currency: Currency;
  ledgerMinor: bigint;
  payazaMinor: bigint;
  driftMinor: bigint;
}

/** Compares BUYER_CLEARING net (Payaza mirror) to Payaza accountBalance per currency. */
export function reconcile(input: {
  ledger: AccountBalance[];
  payaza: { currency: Currency; balanceMinor: bigint }[];
}): DriftFlag[] {
  const flags: DriftFlag[] = [];
  const currencies = new Set<Currency>(input.payaza.map((row) => row.currency));
  for (const currency of currencies) {
    const rows = input.ledger.filter((row) => row.account === "BUYER_CLEARING" && row.currency === currency);
    const ledgerMinor = rows.reduce((sum, row) => sum + netBalance(row), 0n);
    const payazaMinor = input.payaza.find((row) => row.currency === currency)?.balanceMinor ?? 0n;
    const driftMinor = ledgerMinor - payazaMinor;
    if (driftMinor !== 0n) {
      flags.push({ currency, ledgerMinor, payazaMinor, driftMinor });
    }
  }
  return flags;
}

export function openExposureKes(ledger: AccountBalance[]): bigint {
  const rows = ledger.filter((row) => row.account === "FX_CLEARING" && row.currency === "KES");
  const net = rows.reduce((sum, row) => sum + netBalance(row), 0n);
  return net > 0n ? net : 0n;
}
