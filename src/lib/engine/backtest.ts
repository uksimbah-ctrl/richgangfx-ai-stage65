import { readDirection } from "./indicators.ts";
import { digitWins, expectedValue, fairDigit, lastDigit } from "./math.ts";

export type BacktestReport = {
  trials: number;
  wins: number;
  hitRate: number | null;
  referenceRate: number | null;
  breakevenPayout: number | null;
  perTradeEv: number | null;
  note: string;
  /** Digit-engine lines. Empty for a non-digit backtest. */
  lines?: string[];
};

export function backtestDigit(args: {
  prices: number[];
  pipSize: number;
  type: string;
  barrier: string;
  payout: number | null;
  stake: number;
}): BacktestReport {
  const fair = fairDigit(args.type, args.barrier);
  let trials = 0;
  let wins = 0;
  for (let i = 0; i < args.prices.length - 1; i++) {
    const digit = lastDigit(args.prices[i + 1], args.pipSize);
    trials += 1;
    if (digitWins(args.type, args.barrier, digit)) wins += 1;
  }
  return pack({
    trials,
    wins,
    referenceRate: fair,
    payout: args.payout,
    stake: args.stake,
    note: "Each trial is the next tick only. Dollar figures use today's quote on those historical outcomes — Deriv did not offer that price then.",
  });
}

export function backtestRise(args: {
  prices: number[];
  steps: number;
  side: "up" | "down";
  payout: number | null;
  stake: number;
}): BacktestReport {
  let trials = 0;
  let wins = 0;
  const start = Math.max(80, 40);
  for (let i = start; i < args.prices.length - args.steps; i++) {
    const dir = readDirection(args.prices.slice(0, i + 1));
    const aligned = args.side === "up" ? dir.alignedUp : dir.alignedDown;
    if (!aligned) continue;
    trials += 1;
    const future = args.prices[i + args.steps];
    const now = args.prices[i];
    if (args.side === "up" ? future > now : future < now) wins += 1;
    i += args.steps;
  }
  return pack({
    trials,
    wins,
    referenceRate: 0.5,
    payout: args.payout,
    stake: args.stake,
    note: "Signals fire only when this desk's trend votes align. The per-trade figure applies the current payout to those historical signals. It is not a broker statement.",
  });
}

function pack(args: {
  trials: number;
  wins: number;
  referenceRate: number | null;
  payout: number | null;
  stake: number;
  note: string;
}): BacktestReport {
  const hitRate = args.trials > 0 ? args.wins / args.trials : null;
  const breakeven =
    args.referenceRate != null && args.referenceRate > 0 && args.stake > 0
      ? args.stake / args.referenceRate
      : null;
  const perTradeEv =
    hitRate != null && args.payout != null && args.payout > 0
      ? expectedValue(hitRate, args.payout, args.stake)
      : null;
  return {
    trials: args.trials,
    wins: args.wins,
    hitRate,
    referenceRate: args.referenceRate,
    breakevenPayout: breakeven,
    perTradeEv,
    note: args.note,
  };
}
