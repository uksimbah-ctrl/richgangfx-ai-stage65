import { clamp, mean, sampleStd } from "./math.ts";

export type Bar = { high: number; low: number; close: number };

export function emaSeries(values: number[], period: number): number[] {
  if (values.length === 0 || period < 1) return [];
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values[0];
  out.push(prev);
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

export function emaLast(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const series = emaSeries(values, period);
  return series[series.length - 1] ?? null;
}

export function rsi(values: number[], period = 14): number | null {
  if (values.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gains += d;
    else losses -= d;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

export function macdHist(values: number[]): number | null {
  if (values.length < 35) return null;
  const fast = emaSeries(values, 12);
  const slow = emaSeries(values, 26);
  const macd: number[] = [];
  for (let i = 0; i < values.length; i++) macd.push(fast[i] - slow[i]);
  const signal = emaLast(macd.slice(-60), 9);
  if (signal == null) return null;
  return macd[macd.length - 1] - signal;
}

export function barsFromTicks(quotes: number[], size: number): Bar[] {
  if (size < 2) return [];
  const bars: Bar[] = [];
  for (let i = 0; i + size <= quotes.length; i += size) {
    const slice = quotes.slice(i, i + size);
    bars.push({
      high: Math.max(...slice),
      low: Math.min(...slice),
      close: slice[slice.length - 1],
    });
  }
  return bars;
}

export function atr(bars: Bar[], period = 14): number | null {
  if (bars.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = bars.length - period; i < bars.length; i++) {
    const prev = bars[i - 1].close;
    const tr = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - prev),
      Math.abs(bars[i].low - prev),
    );
    trs.push(tr);
  }
  return mean(trs);
}

/** Wilder-style ADX on synthetic tick bars. Returns null until the window fills. */
export function adx(bars: Bar[], period = 14): number | null {
  if (bars.length < period * 2) return null;
  const plus: number[] = [];
  const minus: number[] = [];
  const tr: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const up = bars[i].high - bars[i - 1].high;
    const down = bars[i - 1].low - bars[i].low;
    plus.push(up > down && up > 0 ? up : 0);
    minus.push(down > up && down > 0 ? down : 0);
    tr.push(
      Math.max(
        bars[i].high - bars[i].low,
        Math.abs(bars[i].high - bars[i - 1].close),
        Math.abs(bars[i].low - bars[i - 1].close),
      ),
    );
  }
  const dx: number[] = [];
  for (let i = period; i <= plus.length; i++) {
    const trSum = sum(tr.slice(i - period, i));
    if (trSum <= 0) continue;
    const pdi = (100 * sum(plus.slice(i - period, i))) / trSum;
    const mdi = (100 * sum(minus.slice(i - period, i))) / trSum;
    const den = pdi + mdi;
    dx.push(den === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / den);
  }
  if (dx.length < period) return null;
  return mean(dx.slice(-period));
}

export function bollinger(
  values: number[],
  period = 20,
  mult = 2,
): { mid: number; upper: number; lower: number; width: number } | null {
  if (values.length < period) return null;
  const window = values.slice(-period);
  const mid = mean(window);
  const sd = sampleStd(window);
  if (mid == null || sd == null) return null;
  const upper = mid + mult * sd;
  const lower = mid - mult * sd;
  return { mid, upper, lower, width: mid === 0 ? 0 : (upper - lower) / Math.abs(mid) };
}

export type DirectionRead = {
  score: number;
  emaFast: number | null;
  emaSlow: number | null;
  rsi: number | null;
  macd: number | null;
  adx: number | null;
  atr: number | null;
  alignedUp: boolean;
  alignedDown: boolean;
  /** EMA 9 versus EMA 21, with price on the same side. Fires without the 200-tick stack. */
  fastUp: boolean;
  fastDown: boolean;
};

export function readDirection(
  quotes: number[],
  cfg: { emaFast?: number; emaSlow?: number; rsiPeriod?: number; rsiBuy?: number; rsiSell?: number; minAdx?: number } = {},
): DirectionRead {
  const fastP = cfg.emaFast ?? 9;
  const slowP = cfg.emaSlow ?? 21;
  const rsiP = cfg.rsiPeriod ?? 14;
  const ema9 = emaLast(quotes, fastP);
  const ema21 = emaLast(quotes, slowP);
  const ema50 = emaLast(quotes, 50);
  const ema200 = emaLast(quotes, 200);
  const rsiValue = rsi(quotes, rsiP);
  const macd = macdHist(quotes);
  const bars = barsFromTicks(quotes, 5);
  const adxValue = adx(bars, 14);
  const atrValue = atr(bars, 14);
  const bands = bollinger(quotes, 20, 2);
  const last = quotes.length ? quotes[quotes.length - 1] : null;
  let score = 0;
  if (ema9 != null && ema21 != null) score += ema9 > ema21 ? 1 : -1;
  if (ema50 != null && ema200 != null) score += ema50 > ema200 ? 1 : -1;
  if (macd != null) score += macd > 0 ? 1 : -1;
  if (rsiValue != null) score += rsiValue >= 50 ? 0.6 : -0.6;
  if (adxValue != null && adxValue >= 20) score *= 1.1;
  else score *= 0.7;
  score = clamp(score / 3.6, -1, 1);
  const stacked =
    ema9 != null &&
    ema21 != null &&
    ema50 != null &&
    ema200 != null &&
    macd != null &&
    rsiValue != null &&
    adxValue != null &&
    bands != null &&
    last != null &&
    bands.width <= 0.08;
  const alignedUp =
    stacked &&
    ema9! > ema21! &&
    ema21! > ema50! &&
    ema50! > ema200! &&
    macd! > 0 &&
    rsiValue! > 50 &&
    adxValue! >= 20 &&
    last! > bands!.mid;
  const alignedDown =
    stacked &&
    ema9! < ema21! &&
    ema21! < ema50! &&
    ema50! < ema200! &&
    macd! < 0 &&
    rsiValue! < 50 &&
    adxValue! >= 20 &&
    last! < bands!.mid;
  const adxOk = cfg.minAdx == null || cfg.minAdx <= 0 || (adxValue != null && adxValue >= cfg.minAdx);
  const rsiOkUp = cfg.rsiBuy == null || rsiValue == null || rsiValue >= cfg.rsiBuy;
  const rsiOkDown = cfg.rsiSell == null || rsiValue == null || rsiValue <= cfg.rsiSell;
  const fastUp = ema9 != null && ema21 != null && last != null && ema9 > ema21 && last >= ema9 && rsiOkUp && adxOk;
  const fastDown = ema9 != null && ema21 != null && last != null && ema9 < ema21 && last <= ema9 && rsiOkDown && adxOk;
  return {
    score,
    emaFast: ema9,
    emaSlow: ema21,
    rsi: rsiValue,
    macd,
    adx: adxValue,
    atr: atrValue,
    alignedUp: Boolean(alignedUp),
    alignedDown: Boolean(alignedDown),
    fastUp,
    fastDown,
  };
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
