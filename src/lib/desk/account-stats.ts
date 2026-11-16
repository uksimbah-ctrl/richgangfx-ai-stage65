import { forAccount, hasAccountId, scopedLossStreak } from "./account-scope.ts";
import { tradeOutcome, type FilterableTrade } from "./journal-filter.ts";

export type PerfRow = FilterableTrade & {
  stake?: number;
  modules?: string[];
};

export type AccountPerformance = {
  open: number;
  settled: number;
  wins: number;
  losses: number;
  refunds: number;
  unresolved: number;
  todayPnl: number | null;
  totalPnl: number | null;
  winRate: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  lossStreak: number | null;
};

const EMPTY: AccountPerformance = {
  open: 0,
  settled: 0,
  wins: 0,
  losses: 0,
  refunds: 0,
  unresolved: 0,
  todayPnl: null,
  totalPnl: null,
  winRate: null,
  avgWin: null,
  avgLoss: null,
  lossStreak: null,
};

/**
 * Performance for one exact account id.
 * Win rate is wins / (wins + losses). Refunds and unresolved trades are excluded.
 * Missing profit is unresolved, never a win, loss, or zero.
 * Rows with no account id are excluded. An empty history stays null, not a fake zero profit.
 */
export function accountPerformance(
  rows: PerfRow[],
  accountId: string | null | undefined,
  now = Date.now(),
  sessionResetAt = 0,
): AccountPerformance {
  if (!hasAccountId(accountId)) return { ...EMPTY };
  const mine = forAccount(rows, accountId);
  let open = 0;
  let wins = 0;
  let losses = 0;
  let refunds = 0;
  let unresolved = 0;
  const winAmounts: number[] = [];
  const lossAmounts: number[] = [];
  const known: number[] = [];
  for (const row of mine) {
    const outcome = tradeOutcome(row);
    const profit = row.profit;
    if (outcome === "open") open += 1;
    else if (outcome === "won" && profit != null) {
      wins += 1;
      winAmounts.push(profit);
      known.push(profit);
    } else if (outcome === "lost" && profit != null) {
      losses += 1;
      lossAmounts.push(profit);
      known.push(profit);
    } else if (outcome === "refund" && profit != null) {
      refunds += 1;
      known.push(profit);
    } else unresolved += 1;
  }
  const settled = wins + losses + refunds;
  const decisive = wins + losses;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const since = Math.max(start.getTime(), sessionResetAt);
  const today = mine.filter((row) => row.closedAt != null && row.closedAt >= since && row.profit != null);
  const mean = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
  return {
    open,
    settled,
    wins,
    losses,
    refunds,
    unresolved,
    todayPnl: today.length ? today.reduce((sum, row) => sum + (row.profit ?? 0), 0) : null,
    totalPnl: known.length ? known.reduce((sum, value) => sum + value, 0) : null,
    winRate: decisive === 0 ? null : wins / decisive,
    avgWin: mean(winAmounts),
    avgLoss: mean(lossAmounts),
    lossStreak: settled === 0 ? null : scopedLossStreak(rows, sessionResetAt, accountId),
  };
}

/** How much of the daily loss limit today's realized loss has used. No settled trades means unknown, not zero. */
export function dailyLossUsage(todayPnl: number | null, limit: number): { used: number | null; limit: number; ratio: number | null } {
  const cap = Number.isFinite(limit) ? Math.abs(limit) : 0;
  if (todayPnl == null || !Number.isFinite(todayPnl)) return { used: null, limit: cap, ratio: null };
  const used = todayPnl < 0 ? -todayPnl : 0;
  return { used, limit: cap, ratio: cap > 0 ? used / cap : null };
}

export type StrategyRecord = {
  trades: number;
  wins: number;
  losses: number;
  pnl: number;
};

/** Account-tagged settled trades only. Null when this account has no recorded profit for the strategy. */
export function strategyRecord(rows: PerfRow[], accountId: string | null | undefined, moduleId: string): StrategyRecord | null {
  if (!hasAccountId(accountId)) return null;
  const known = forAccount(rows, accountId).filter(
    (row) => (row.modules ?? []).includes(moduleId) && row.closedAt != null && row.profit != null,
  );
  if (known.length === 0) return null;
  const wins = known.filter((row) => (row.profit ?? 0) > 0).length;
  const losses = known.filter((row) => (row.profit ?? 0) < 0).length;
  const pnl = known.reduce((sum, row) => sum + (row.profit ?? 0), 0);
  return { trades: known.length, wins, losses, pnl };
}
