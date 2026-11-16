import { digitWins, fairDigit } from "./math.ts";

export type DigitStudy = {
  n: number;
  fair: number;
  mean: number;
  lower: number;
  windowsAgree: boolean;
  ready: boolean;
  reason: string;
};

/**
 * Posterior for one digit contract.
 * A prior centered on the fair chance keeps a short hot streak from looking like an edge.
 * The lower bound is what the trade gate compares with the payout's break-even chance.
 */
export function studyDigit(args: {
  digits: number[];
  type: string;
  barrier: string;
  minSample: number;
  prior: number;
  z: number;
}): DigitStudy {
  const fair = fairDigit(args.type, args.barrier);
  const n = args.digits.length;
  if (fair == null) {
    return { n, fair: 0, mean: 0, lower: 0, windowsAgree: false, ready: false, reason: "No fair probability for this barrier." };
  }
  const stats = posterior(args.digits, args.type, args.barrier, fair, args.prior, args.z);
  const windowsAgree = windowsMatch(args.digits, args.type, args.barrier, fair);
  if (n < args.minSample) {
    return {
      ...stats,
      n,
      fair,
      windowsAgree,
      ready: false,
      reason: `Digit sample ${n}/${args.minSample}. The estimate is not used yet.`,
    };
  }
  if (!windowsAgree) {
    return {
      ...stats,
      n,
      fair,
      windowsAgree: false,
      ready: false,
      reason: "The recent window disagrees with the longer sample, so this is not a signal.",
    };
  }
  return {
    ...stats,
    n,
    fair,
    windowsAgree: true,
    ready: true,
    reason: "Lower bound is the chance used for expected value. It is not a win rate.",
  };
}

/**
 * Barrier with the highest lower bound on the digits passed in.
 * Those digits must be the training period only. Validation and final-test ticks must not be included.
 */
export function bestDigitBarrier(
  digits: number[],
  type: string,
  allowed: number[],
  prior: number,
  z: number,
): number | null {
  let best: number | null = null;
  let score = -Infinity;
  for (const barrier of allowed) {
    const fair = fairDigit(type, String(barrier));
    if (fair == null) continue;
    const row = posterior(digits, type, String(barrier), fair, prior, z);
    const edge = row.lower - fair;
    if (edge > score) {
      score = edge;
      best = barrier;
    }
  }
  return best;
}

function windowsMatch(digits: number[], type: string, barrier: string, fair: number): boolean {
  if (digits.length < 50) return true;
  const short = rate(digits.slice(-50), type, barrier) - fair;
  const long = rate(digits, type, barrier) - fair;
  return !(short > 0.02 && long <= 0);
}

function posterior(
  digits: number[],
  type: string,
  barrier: string,
  fair: number,
  prior: number,
  z: number,
): { mean: number; lower: number } {
  const n = digits.length;
  const wins = digits.reduce((sum, digit) => sum + (digitWins(type, barrier, digit) ? 1 : 0), 0);
  const strength = Math.max(1, prior);
  const a = strength * fair;
  const b = strength * (1 - fair);
  const mean = (wins + a) / (n + a + b);
  const variance = (mean * (1 - mean)) / (n + strength + 1);
  const lower = clamp01(mean - Math.max(0, z) * Math.sqrt(Math.max(0, variance)));
  return { mean: clamp01(mean), lower };
}

function rate(digits: number[], type: string, barrier: string): number {
  if (digits.length === 0) return 0;
  const wins = digits.reduce((sum, digit) => sum + (digitWins(type, barrier, digit) ? 1 : 0), 0);
  return wins / digits.length;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}
