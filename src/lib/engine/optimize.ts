import { emaLast } from "./indicators.ts";
import { digitWins, fairDigit, lastDigit } from "./math.ts";

export type OptRow = {
  label: string;
  inSampleHit: number | null;
  outSampleHit: number | null;
  outTrials: number;
  fair: number | null;
};

/** Walk-forward. The second slice is scored only after the first slice has chosen nothing for it. */
export function optimizeEma(prices: number[], steps = 5): OptRow[] {
  if (prices.length < 80) return [];
  const split = Math.floor(prices.length * 0.7);
  const grid: Array<[number, number]> = [
    [5, 13],
    [8, 21],
    [9, 21],
    [12, 26],
  ];
  return grid
    .map(([fast, slow]) => ({
      label: `EMA ${fast}/${slow}, ${steps} ticks`,
      inSampleHit: hitRate(prices, 0, split, fast, slow, steps),
      outSampleHit: hitRate(prices, split, prices.length, fast, slow, steps),
      outTrials: trials(prices, split, prices.length, fast, slow, steps),
      fair: 0.5,
    }))
    .sort((a, b) => (b.outSampleHit ?? -1) - (a.outSampleHit ?? -1));
}

export function optimizeDigit(prices: number[], pipSize: number, type: string, barriers: string[]): OptRow[] {
  if (prices.length < 40) return [];
  const split = Math.floor(prices.length * 0.7);
  return barriers.map((barrier) => {
    const fair = fairDigit(type, barrier);
    return {
      label: `${type} ${barrier || "no barrier"}`,
      inSampleHit: digitHit(prices, pipSize, type, barrier, 0, split),
      outSampleHit: digitHit(prices, pipSize, type, barrier, split, prices.length),
      outTrials: Math.max(0, prices.length - split - 1),
      fair,
    };
  });
}

function hitRate(prices: number[], from: number, to: number, fast: number, slow: number, steps: number): number | null {
  const n = trials(prices, from, to, fast, slow, steps);
  if (n === 0) return null;
  let wins = 0;
  for (let i = Math.max(from, slow); i < to - steps; i += steps) {
    if (!bullish(prices.slice(0, i + 1), fast, slow)) continue;
    if (prices[i + steps] > prices[i]) wins += 1;
  }
  return wins / n;
}

function trials(prices: number[], from: number, to: number, fast: number, slow: number, steps: number): number {
  let n = 0;
  for (let i = Math.max(from, slow); i < to - steps; i += steps) {
    if (bullish(prices.slice(0, i + 1), fast, slow)) n += 1;
  }
  return n;
}

function bullish(prices: number[], fast: number, slow: number): boolean {
  const a = emaLast(prices, fast);
  const b = emaLast(prices, slow);
  const last = prices[prices.length - 1];
  return a != null && b != null && a > b && last >= a;
}

function digitHit(prices: number[], pip: number, type: string, barrier: string, from: number, to: number): number | null {
  let n = 0;
  let wins = 0;
  for (let i = from; i < to - 1; i++) {
    n += 1;
    if (digitWins(type, barrier, lastDigit(prices[i + 1], pip))) wins += 1;
  }
  return n > 0 ? wins / n : null;
}
