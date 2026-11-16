export type JournalOutcome = "won" | "lost" | "refund" | "open" | "unresolved";

export type JournalQuery = {
  accountKind: "all" | "demo" | "real" | "unknown";
  accountId: string;
  from: string;
  to: string;
  contractType: string;
  strategy: string;
  symbol: string;
  outcome: "all" | JournalOutcome;
};

export type FilterableTrade = {
  accountId?: string | null;
  accountType?: string | null;
  openedAt?: number;
  closedAt?: number;
  profit?: number | null;
  status: string;
  contractType?: string;
  symbol?: string;
  modules?: string[];
  settlement?: { isSold?: boolean } | null;
};

export const EMPTY_JOURNAL_QUERY: JournalQuery = {
  accountKind: "all",
  accountId: "",
  from: "",
  to: "",
  contractType: "",
  strategy: "",
  symbol: "",
  outcome: "all",
};

/** Profit must be a real number. Missing profit is never a win, loss, or refund. */
export function tradeOutcome(row: FilterableTrade): JournalOutcome {
  const open = row.status === "open" || row.closedAt == null;
  if (open) {
    if (row.settlement?.isSold && row.profit == null) return "unresolved";
    if (row.profit == null) return "open";
    return "unresolved";
  }
  if (row.profit == null) return "unresolved";
  if (row.profit > 0) return "won";
  if (row.profit < 0) return "lost";
  return "refund";
}

export function outcomeLabel(outcome: JournalOutcome): string {
  if (outcome === "won") return "Won";
  if (outcome === "lost") return "Lost";
  if (outcome === "refund") return "Refunded";
  if (outcome === "open") return "Open";
  return "Unresolved";
}

function dayKey(ms?: number): string {
  if (ms == null || !Number.isFinite(ms)) return "";
  return new Date(ms).toISOString().slice(0, 10);
}

export function filterJournal<T extends FilterableTrade>(rows: T[], query: JournalQuery): T[] {
  return rows.filter((row) => {
    const outcome = tradeOutcome(row);
    if (query.outcome !== "all" && outcome !== query.outcome) return false;
    const id = typeof row.accountId === "string" ? row.accountId.trim() : "";
    if (query.accountKind === "unknown" && id) return false;
    if (query.accountKind === "demo" && row.accountType !== "demo") return false;
    if (query.accountKind === "real" && row.accountType !== "real") return false;
    if (query.accountId && id !== query.accountId) return false;
    if (query.contractType && row.contractType !== query.contractType) return false;
    if (query.symbol && row.symbol !== query.symbol) return false;
    if (query.strategy && !(row.modules ?? []).includes(query.strategy)) return false;
    const day = dayKey(row.openedAt ?? row.closedAt);
    if (query.from && (!day || day < query.from)) return false;
    if (query.to && (!day || day > query.to)) return false;
    return true;
  });
}
