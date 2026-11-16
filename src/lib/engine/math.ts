/** Exact digit probabilities. History is not allowed to raise these. */
export function fairDigit(type: string, barrier: string): number | null {
  if (type === "DIGITEVEN" || type === "DIGITODD") return 0.5;
  if (type === "DIGITMATCH") return 0.1;
  if (type === "DIGITDIFF") return 0.9;
  const b = Number(barrier);
  if (!Number.isInteger(b) || b < 0 || b > 9) return null;
  if (type === "DIGITOVER") return (9 - b) / 10;
  if (type === "DIGITUNDER") return b / 10;
  return null;
}

/** Digits the contract can use as a barrier. Null means the contract has no digit barrier. */
export function digitChoices(type: string): number[] | null {
  if (type === "DIGITOVER") return [0, 1, 2, 3, 4, 5, 6, 7, 8];
  if (type === "DIGITUNDER") return [1, 2, 3, 4, 5, 6, 7, 8, 9];
  if (type === "DIGITMATCH" || type === "DIGITDIFF") return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  return null;
}

export function lastDigit(quote: number, pipSize: number): number {
  const places = decimalPlaces(pipSize);
  const text = quote.toFixed(places).replace(".", "");
  return Number(text.slice(-1));
}

export function decimalPlaces(pipSize: number): number {
  if (!Number.isFinite(pipSize) || pipSize < 0) return 2;
  if (pipSize >= 1 && Number.isInteger(pipSize) && pipSize <= 8) return pipSize;
  if (pipSize > 0 && pipSize < 1) {
    const n = Math.round(-Math.log10(pipSize));
    return Math.min(8, Math.max(0, n));
  }
  return 2;
}

export function digitWins(type: string, barrier: string, digit: number): boolean {
  const b = Number(barrier);
  if (type === "DIGITEVEN") return digit % 2 === 0;
  if (type === "DIGITODD") return digit % 2 === 1;
  if (type === "DIGITMATCH") return digit === b;
  if (type === "DIGITDIFF") return digit !== b;
  if (type === "DIGITOVER") return digit > b;
  if (type === "DIGITUNDER") return digit < b;
  return false;
}

/** Payout is the total return if the contract wins, including stake. */
export function expectedValue(probability: number, payout: number, stake: number): number {
  return probability * payout - stake;
}

export function impliedProbability(payout: number, stake: number): number | null {
  if (!(payout > 0) || !(stake > 0)) return null;
  return stake / payout;
}

export function edgeRatio(ev: number, stake: number): number {
  if (!(stake > 0)) return 0;
  return ev / stake;
}

export function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804 * Math.exp((-x * x) / 2);
  const p =
    d *
    t *
    (0.31938153 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

/** P(hit a barrier `distance` away within `steps` ticks), driftless reflection bound. */
export function touchProbability(distance: number, sigma: number, steps: number): number {
  if (distance <= 0) return 1;
  if (!(sigma > 0) || !(steps > 0)) return 0;
  const z = distance / (sigma * Math.sqrt(steps));
  return clamp(2 * (1 - normalCdf(z)), 0, 1);
}

export function terminalBetween(
  lower: number,
  upper: number,
  sigma: number,
  steps: number,
): number {
  if (!(sigma > 0) || !(steps > 0) || !(upper > lower)) return 0;
  const scale = sigma * Math.sqrt(steps);
  return clamp(normalCdf(upper / scale) - normalCdf(lower / scale), 0, 1);
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function roundStake(n: number): number {
  return Math.round(n * 100) / 100;
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function sampleStd(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  const v = values.reduce((a, b) => a + (b - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(v);
}

export function tickDeltas(quotes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < quotes.length; i++) out.push(quotes[i] - quotes[i - 1]);
  return out;
}

export function digitCounts(quotes: number[], pipSize: number): number[] {
  const counts = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const q of quotes) counts[lastDigit(q, pipSize)] += 1;
  return counts;
}

/** Chi-square against a uniform digit. df=9, ~21.67 is p=0.01. */
export function digitChiSquare(counts: number[]): number {
  const n = counts.reduce((a, b) => a + b, 0);
  if (n <= 0) return 0;
  const expected = n / 10;
  return counts.reduce((sum, c) => sum + (c - expected) ** 2 / expected, 0);
}

export function formatBarrier(offset: number, places: number): string {
  const abs = Math.abs(offset).toFixed(places);
  return offset >= 0 ? `+${abs}` : `-${abs}`;
}
