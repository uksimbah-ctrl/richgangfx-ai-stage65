import { digitChoices, digitWins, expectedValue, fairDigit, impliedProbability, lastDigit } from "./math.ts";
import {
  clearsBaseline,
  digitFrequencies,
  effectiveSample,
  pct,
  predictionLabel,
  wilsonInterval,
} from "./digit-stats.ts";

/**
 * Weak baseline prior. Strength 20 is ten times a single digit's fair weight and is not evidence of an edge.
 * Matches is Beta(2, 18). Differs uses the complement of that same posterior.
 * Even and Odd are each Beta(10, 10), fit on their own outcomes.
 * Over b is Beta(2*(9-b), 2*b). Under b is Beta(2*b, 2*(9-b)).
 */
export const NO_VERIFIED_EDGE = "NO VERIFIED EDGE — INSUFFICIENT EVIDENCE.";

export const PRIOR_STRENGTH = 20;

export const DIGIT_ENGINE_CONTRACTS = ["DIGITMATCH", "DIGITDIFF", "DIGITOVER", "DIGITUNDER", "DIGITEVEN", "DIGITODD"] as const;

export type DigitEngineContract = (typeof DIGIT_ENGINE_CONTRACTS)[number];

export function baselinePrior(fair: number): { alpha: number; beta: number; note: string } {
  const alpha = round4(fair * PRIOR_STRENGTH);
  const beta = round4((1 - fair) * PRIOR_STRENGTH);
  return {
    alpha,
    beta,
    note: `Beta(${alpha}, ${beta}), mean ${pct(fair)}, strength ${PRIOR_STRENGTH}. A baseline prior is not an edge.`,
  };
}

export function betaPosterior(
  hits: number,
  n: number,
  alpha: number,
  beta: number,
  z = 1.64,
): { mean: number; lo: number; hi: number; alpha: number; beta: number } {
  const a = alpha + hits;
  const b = beta + Math.max(0, n - hits);
  const mean = a / (a + b);
  const variance = (a * b) / ((a + b) ** 2 * (a + b + 1));
  const sd = Math.sqrt(Math.max(0, variance));
  return { mean, lo: clamp01(mean - z * sd), hi: clamp01(mean + z * sd), alpha: a, beta: b };
}

export type EngineReport = {
  contract: string;
  prediction: string;
  fair: number | null;
  hits: number;
  sample: number;
  nEff: number;
  observed: number;
  estimated: number;
  lo: number;
  hi: number;
  ewma: number | null;
  oosTrials: number;
  oosHits: number;
  breakEven: number | null;
  expectedReturn: number | null;
  prior: string;
  qualified: boolean;
  status: "yes" | "no" | "wait";
  reason: string;
};

export function runDigitEngine(args: {
  contract: string;
  quotes: number[];
  pip: number;
  barrier: string;
  minSample: number;
  minConfidence: number;
  strategy: string;
  lookback?: number;
  minEffective?: number;
  z?: number;
  /** When true, a held-out tail must also clear the baseline. */
  persist?: boolean;
  stake?: number | null;
  payout?: number | null;
}): EngineReport {
  const freq = digitFrequencies(args.quotes, args.pip);
  const fair = fairDigit(args.contract, args.barrier);
  const prediction = predictionLabel(args.contract, args.barrier);
  const empty = (status: "yes" | "no" | "wait", reason: string): EngineReport => ({
    contract: args.contract,
    prediction,
    fair,
    hits: 0,
    sample: freq.sample,
    nEff: 0,
    observed: 0,
    estimated: 0,
    lo: 0,
    hi: 1,
    ewma: null,
    oosTrials: 0,
    oosHits: 0,
    breakEven: null,
    expectedReturn: null,
    prior: "",
    qualified: false,
    status,
    reason: reason.includes(NO_VERIFIED_EDGE) ? reason : `${reason} ${NO_VERIFIED_EDGE}`,
  });
  if (!DIGIT_ENGINE_CONTRACTS.includes(args.contract as DigitEngineContract)) {
    return empty("no", `${args.strategy} does not trade ${args.contract}.`);
  }
  if (fair == null) return empty("no", "Pick a valid digit for this contract before it can be judged.");
  if (fair <= 0 || fair >= 1) return empty("no", "That barrier has no tradable baseline, so it is not a signal.");
  const appearance = appearanceFlags(args.contract, args.barrier, freq.digits);
  if (!appearance) return empty("no", "Pick a valid digit for this contract before it can be judged.");
  const distinct = new Set(freq.digits).size;
  if (distinct < 3) {
    return empty(
      "wait",
      `WAIT. ${freq.sample} ticks contain only ${distinct} distinct last digit${distinct === 1 ? "" : "s"}. A repeated digit is not evidence the next tick must match, differ, or flip. Not qualified. This is not a guaranteed win rate.`,
    );
  }
  const z = Number.isFinite(args.z) && (args.z ?? 0) >= 1 && (args.z ?? 0) <= 2.58 ? (args.z as number) : 1.64;
  const minEffective = Number.isFinite(args.minEffective) ? Math.max(10, args.minEffective as number) : 40;
  const persist = args.persist !== false;
  const model = modelContract(args.contract, appearance.flags, fair, z);
  if (model.nEff < minEffective) {
    return {
      ...empty(
        "wait",
        `WAIT. Effective sample is about ${Math.round(model.nEff)} of ${model.sample}. Need ${minEffective} after dependence. No probability was invented. This is not a guaranteed win rate.`,
      ),
      hits: model.hits,
      sample: model.sample,
      nEff: model.nEff,
      observed: model.observed,
      estimated: model.estimated,
      lo: model.lo,
      hi: model.hi,
      prior: model.prior,
    };
  }
  const lookback = Math.max(20, Math.min(200, Math.round(args.lookback ?? 40) || 40));
  const recent = model.contractFlags.slice(-Math.min(model.contractFlags.length, lookback));
  const recentP = recent.length ? recent.filter(Boolean).length / recent.length : model.observed;
  const side = model.estimated - fair;
  const rollingAgrees = recent.length < 20 || Math.abs(recentP - fair) <= 0.02 || side * (recentP - fair) >= 0;
  const width = Math.max(20, Math.min(80, lookback));
  let windows = 0;
  let momentumAgrees = true;
  if (model.contractFlags.length >= width * 2) {
    const start = model.contractFlags.length % width;
    const rates: number[] = [];
    for (let i = start; i + width <= model.contractFlags.length; i += width) {
      const slice = model.contractFlags.slice(i, i + width);
      rates.push(slice.filter(Boolean).length / slice.length);
    }
    windows = rates.length;
    const last = rates[rates.length - 1];
    if (last != null && Math.abs(last - fair) > 0.02 && side * (last - fair) < 0) momentumAgrees = false;
  }
  const ewma = weightedRate(model.contractFlags, lookback);
  const tail = holdout(model.contractFlags, args.minSample);
  const tailDisagrees = tail.trials >= 20 && Math.abs(tail.rate - fair) > 0.02 && side * (tail.rate - fair) < 0;
  const tailClears = tail.trials >= 40 && clearsBaseline(tail.lo, fair, args.minConfidence);
  const cleared = clearsBaseline(model.lo, fair, args.minConfidence);
  let status: "yes" | "no" | "wait" = "no";
  if (!rollingAgrees || !momentumAgrees || tailDisagrees) status = "wait";
  else if (persist && cleared && tail.trials >= 40 && !tailClears) status = "wait";
  else if (cleared && (!persist || tail.trials < 40 || tailClears)) status = "yes";
  const quote = quoteMath(args.stake, args.payout, model.estimated);
  const lossNote =
    args.contract === "DIGITDIFF"
      ? " A single loss costs the stake. A win rate near 90% is not profit unless the payout is above the break-even price."
      : args.contract === "DIGITMATCH"
        ? " A long absence is not a reason to buy Matches."
        : "";
  const money =
    quote.breakEven == null
      ? " Break-even needs a proposal payout. A high probability is not a profit."
      : ` Break-even probability ${pct(quote.breakEven)}. Expected return ${quote.expectedReturn == null ? "—" : quote.expectedReturn.toFixed(3)} at the quoted payout.${quote.expectedReturn != null && quote.expectedReturn < 0 ? " Expected return is negative at this quote. That is shown and is not a hidden block." : ""}`;
  const body = `${args.strategy}. ${prediction}. Theoretical baseline ${pct(fair)}. Observed frequency ${pct(model.observed)} on ${model.hits} of ${model.sample} ticks. Those are not the same number, and neither one is predictive power. Posterior estimate ${pct(model.estimated)}. Interval ${pct(model.lo)} to ${pct(model.hi)}. Effective sample ${Math.round(model.nEff)}. ${model.prior} Recent ${recent.length} ticks ${rollingAgrees ? "agree" : "do not agree"}. ${windows} non-overlapping windows. Weighted frequency ${ewma == null ? "—" : pct(ewma)} is descriptive only. Held-out tail ${tail.hits}/${tail.trials}. A deviation is not assumed to reverse or continue. These checks are one distribution, not separate confirmation.${lossNote}${money} This is not a guaranteed win rate. ${NO_VERIFIED_EDGE}`;
  const reason = !rollingAgrees
    ? `WAIT. The recent window disagrees with the longer sample. That disagreement is not a reversal signal. ${body}`
    : !momentumAgrees
      ? `WAIT. The latest non-overlapping window disagrees with the longer sample. ${body}`
      : tailDisagrees
        ? `WAIT. UNPROVEN. The held-out period did not keep the same side of the baseline. ${body}`
        : persist && tail.trials >= 40 && !tailClears && cleared
          ? `WAIT. UNPROVEN. The held-out lower bound does not clear the baseline. ${body}`
          : status === "yes"
            ? `${body} Qualified because the lower bound is above that baseline.`
            : `${body} Not qualified. The estimate being above the baseline is not enough when the lower bound still covers it.`;
  return {
    contract: args.contract,
    prediction,
    fair,
    hits: model.hits,
    sample: model.sample,
    nEff: model.nEff,
    observed: model.observed,
    estimated: model.estimated,
    lo: model.lo,
    hi: model.hi,
    ewma,
    oosTrials: tail.trials,
    oosHits: tail.hits,
    breakEven: quote.breakEven,
    expectedReturn: quote.expectedReturn,
    prior: model.prior,
    qualified: status === "yes",
    status,
    reason,
  };
}

/** Ranks barriers for display. It does not change the digit the user picked. */
export function describeBarriers(args: {
  contract: string;
  quotes: number[];
  pip: number;
  minSample: number;
  minConfidence: number;
  selected: string;
}): { barrier: string; lo: number; fair: number; status: string }[] {
  const choices = digitChoices(args.contract) ?? [];
  return choices.map((digit) => {
    const barrier = String(digit);
    const row = runDigitEngine({
      contract: args.contract,
      quotes: args.quotes,
      pip: args.pip,
      barrier,
      minSample: args.minSample,
      minConfidence: args.minConfidence,
      strategy: "Barrier scan",
      persist: true,
    });
    return {
      barrier,
      lo: row.lo,
      fair: row.fair ?? 0,
      status: barrier === args.selected ? row.status : "descriptive",
    };
  });
}

export type DigitBacktest = {
  contract: string;
  barrier: string;
  engine: string;
  decisions: number;
  /** Windows that were scored. A window that does not qualify is not a trade. */
  checked: number;
  oosTrials: number;
  oosHits: number;
  oosHitRate: number | null;
  oosEv: number | null;
  maxDrawdown: number | null;
  profitFactor: number | null;
  brier: number | null;
  payout: number | null;
  /** Qualified simulated wins. Not a settlement record. */
  simWins: number;
  /** Qualified simulated losses. A refund is not included. */
  simLosses: number;
  grossPayout: number | null;
  net: number | null;
  avgStake: number | null;
  breakEven: number | null;
  /** Drawdown across every qualified simulated decision, not only the held-out tail. */
  simDrawdown: number | null;
  verdict: "unproven" | "no-edge" | "supported";
  note: string;
};

export function backtestDigitEngine(args: {
  prices: number[];
  pip: number;
  contract: string;
  barrier: string;
  stake: number;
  payout: number | null;
  minSample?: number;
  minConfidence?: number;
  lookback?: number;
  engine?: string;
}): DigitBacktest {
  const minSample = args.minSample ?? 80;
  const lookback = args.lookback ?? 40;
  const step = Math.max(10, Math.round(lookback));
  const fair = fairDigit(args.contract, args.barrier);
  const decisions: { win: boolean; p: number; profit: number }[] = [];
  let checked = 0;
  if (fair == null || fair <= 0 || fair >= 1) {
    return packBacktest(args, [], 0, fair, "unproven", "That barrier has no tradable baseline, so it was not ranked.");
  }
  for (let i = minSample; i < args.prices.length - 1; i += step) {
    const past = args.prices.slice(0, i + 1);
    const future = lastDigit(args.prices[i + 1], args.pip);
    if (future < 0 || future > 9) continue;
    checked += 1;
    const report = runDigitEngine({
      contract: args.contract,
      quotes: past,
      pip: args.pip,
      barrier: args.barrier,
      minSample,
      minConfidence: args.minConfidence ?? 0.5,
      strategy: args.engine ?? "Digit engine",
      lookback,
      persist: false,
      stake: args.stake,
      payout: args.payout,
    });
    if (report.status !== "yes") continue;
    const win = digitWins(args.contract, args.barrier, future);
    const profit = args.payout != null && args.payout > 0 ? (win ? args.payout - args.stake : -args.stake) : 0;
    decisions.push({ win, p: report.estimated, profit });
  }
  if (args.payout == null || !(args.payout > 0)) {
    return packBacktest(args, decisions, checked, fair, "unproven", "No proposal payout was available, so expected return was not invented.");
  }
  return packBacktest(
    args,
    decisions,
    checked,
    fair,
    null,
    "SIMULATED USING CURRENT PAYOUT. Decisions use only earlier ticks. Overlapping windows are not extra samples. This payout was not offered on those historical ticks.",
  );
}

export function rankDigitBacktests(rows: DigitBacktest[]): { best: DigitBacktest | null; note: string } {
  const supported = rows.filter((row) => row.verdict === "supported");
  const scanned = rows.length > 1 ? ` ${rows.length} barriers were scored separately. That scan is not independent confirmation, and it does not pick a digit for the user.` : "";
  if (supported.length === 0) {
    return { best: null, note: `No digit engine showed a reliable out-of-sample edge on this sample. Unproven is not a hidden winner. ${NO_VERIFIED_EDGE}${scanned}` };
  }
  const best = [...supported].sort((a, b) => (b.oosEv ?? -Infinity) - (a.oosEv ?? -Infinity) || (a.maxDrawdown ?? Infinity) - (b.maxDrawdown ?? Infinity))[0];
  return {
    best,
    note: `${best.engine} leads this sample on out-of-sample expected return, not on win rate. It is not a claim the next contract is profitable.${scanned}`,
  };
}

export function backtestCategories(row: DigitBacktest, sample: number): string[] {
  const span = wilsonInterval(row.oosHits, row.oosTrials);
  const interval = row.oosTrials > 0 ? `${pct(span.lo)} to ${pct(span.hi)}` : "—";
  const money = (value: number | null, digits = 2) => (value == null ? "—" : value.toFixed(digits));
  const edge = row.verdict === "supported" ? "This sample's out-of-sample return was positive. That is not a promise about the next contract." : NO_VERIFIED_EDGE;
  return [
    `A. Synthetic probability test. Not market performance. Theoretical baseline is separate from the observed frequency. Verdict ${row.verdict}.`,
    `B. Historical tick simulation on ${sample} ticks. A prediction uses only earlier ticks. This is the latest window returned by the feed, not a dated archive.`,
    row.payout != null
      ? `C. SIMULATED USING CURRENT PAYOUT ${row.payout}. Deriv did not offer that price on the historical ticks. A different payout changes the result.`
      : "C. SIMULATED USING CURRENT PAYOUT was not run. No historical payout was invented.",
    "D. Historical Deriv proposal performance is not available. Demo and live settlement records were not used and are not combined.",
    `Signals checked ${row.checked}. Qualified signals ${row.decisions}. Trades executed 0. Simulated wins ${row.simWins}. Simulated losses ${row.simLosses}. Refunds 0. Unresolved 0.`,
    `Gross payout ${money(row.grossPayout)}. Net ${money(row.net)}. Maximum simulated drawdown ${money(row.simDrawdown)}. Average stake ${money(row.avgStake)}. Average payout ${money(row.payout)}. Break-even ${row.breakEven == null ? "—" : pct(row.breakEven)}. Out-of-sample interval ${interval}. Out-of-sample ${row.oosHits}/${row.oosTrials}. These are not settlement records.`,
    edge,
  ];
}

/** Stake, total payout, and loss. Total payout is the proposal field, not net profit. */
export function digitQuoteBreakdown(args: { ask: number | null; payout: number | null; probability: number | null; contract?: string }): {
  netProfit: number | null;
  loss: number | null;
  breakEven: number | null;
  expectedReturn: number | null;
  ratio: number | null;
  text: string;
} {
  const ask = args.ask != null && args.ask > 0 ? args.ask : null;
  const payout = args.payout != null && args.payout > 0 ? args.payout : null;
  const netProfit = ask != null && payout != null ? payout - ask : null;
  const loss = ask;
  const breakEven = ask != null && payout != null ? impliedProbability(payout, ask) : null;
  const expectedReturn =
    ask != null && payout != null && args.probability != null ? args.probability * (payout - ask) - (1 - args.probability) * ask : null;
  const ratio = ask != null && payout != null ? payout / ask : null;
  const differs = args.contract === "DIGITDIFF" ? " Theoretical baseline for Differs is 90%. A measured frequency near 90% does not predict the next tick. One loss costs the full ask." : "";
  const numbers =
    ask == null || payout == null
      ? "Break-even needs the proposal ask and total payout. Neither was invented."
      : `Ask ${ask.toFixed(2)}. Total payout if won ${payout.toFixed(2)}. Net profit if won ${netProfit?.toFixed(2)}. A loss costs the full ask ${ask.toFixed(2)}. Break-even probability ${breakEven == null ? "—" : pct(breakEven)}. Payout-to-stake ratio ${ratio == null ? "—" : ratio.toFixed(3)}. Expected return ${expectedReturn == null ? "—" : expectedReturn.toFixed(3)} uses the stated probability.`;
  return { netProfit, loss, breakEven, expectedReturn, ratio, text: `${numbers}${differs} ${NO_VERIFIED_EDGE}` };
}

function packBacktest(
  args: { contract: string; barrier: string; stake: number; payout: number | null; engine?: string },
  decisions: { win: boolean; p: number; profit: number }[],
  checked: number,
  fair: number | null,
  forced: DigitBacktest["verdict"] | null,
  note: string,
): DigitBacktest {
  const oos = decisions.slice(Math.floor(decisions.length * 0.7));
  const hits = oos.filter((row) => row.win).length;
  const hitRate = oos.length ? hits / oos.length : null;
  const ev = args.payout != null && hitRate != null ? expectedValue(hitRate, args.payout, args.stake) : null;
  let equity = 0;
  let peak = 0;
  let drawdown = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let brierSum = 0;
  for (const row of oos) {
    equity += row.profit;
    peak = Math.max(peak, equity);
    drawdown = Math.max(drawdown, peak - equity);
    if (row.profit > 0) grossWin += row.profit;
    if (row.profit < 0) grossLoss += -row.profit;
    brierSum += (row.p - (row.win ? 1 : 0)) ** 2;
  }
  let path = 0;
  let pathPeak = 0;
  let simDrawdown = 0;
  let simWins = 0;
  let grossPayout = 0;
  let net = 0;
  for (const row of decisions) {
    if (row.win) simWins += 1;
    path += row.profit;
    net += row.profit;
    pathPeak = Math.max(pathPeak, path);
    simDrawdown = Math.max(simDrawdown, pathPeak - path);
    if (row.win && args.payout != null && args.payout > 0) grossPayout += args.payout;
  }
  const span = wilsonInterval(hits, oos.length);
  let verdict: DigitBacktest["verdict"] = forced ?? "unproven";
  if (!forced) {
    const beatsBaseline = fair != null && oos.length >= 12 && span.lo > fair;
    if (oos.length < 12 || ev == null || fair == null) verdict = "unproven";
    else if (!beatsBaseline) verdict = "unproven";
    else if (ev <= 0 || grossWin <= grossLoss) verdict = "no-edge";
    else verdict = "supported";
  }
  const priced = args.payout != null && args.payout > 0;
  return {
    contract: args.contract,
    barrier: args.barrier,
    engine: args.engine ?? args.contract,
    decisions: decisions.length,
    checked,
    oosTrials: oos.length,
    oosHits: hits,
    oosHitRate: hitRate,
    oosEv: ev,
    maxDrawdown: oos.length ? drawdown : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    brier: oos.length ? brierSum / oos.length : null,
    payout: args.payout,
    simWins,
    simLosses: decisions.length - simWins,
    grossPayout: priced && decisions.length ? grossPayout : null,
    net: priced && decisions.length ? net : null,
    avgStake: decisions.length ? args.stake : null,
    breakEven: priced ? impliedProbability(args.payout as number, args.stake) : null,
    simDrawdown: decisions.length ? simDrawdown : null,
    verdict,
    note,
  };
}

function modelContract(contract: string, appearance: boolean[], fair: number, z: number) {
  const sample = appearance.length;
  const eventHits = appearance.reduce((sum, flag) => sum + (flag ? 1 : 0), 0);
  const complement = contract === "DIGITDIFF";
  const span =
    eventHits === 0 || eventHits === sample
      ? { n: sample, hits: eventHits, nEff: sample, rho: 0 }
      : effectiveSample(appearance);
  const hitsEff = sample > 0 ? (span.hits / sample) * span.nEff : 0;
  const wilson = wilsonInterval(hitsEff, span.nEff, z);
  const eventFair = complement ? 1 - fair : fair;
  const prior = baselinePrior(eventFair);
  const beta = betaPosterior(span.hits, sample, prior.alpha, prior.beta, z);
  const eventLo = Math.min(wilson.lo, beta.lo);
  const eventHi = Math.max(wilson.hi, beta.hi);
  const eventP = beta.mean;
  const observedEvent = sample ? eventHits / sample : 0;
  const contractFlags = complement ? appearance.map((flag) => !flag) : appearance;
  const hits = complement ? sample - eventHits : eventHits;
  return {
    hits,
    sample,
    nEff: span.nEff,
    observed: complement ? 1 - observedEvent : observedEvent,
    estimated: complement ? 1 - eventP : eventP,
    lo: complement ? 1 - eventHi : eventLo,
    hi: complement ? 1 - eventLo : eventHi,
    prior: prior.note,
    contractFlags,
  };
}

function appearanceFlags(contract: string, barrier: string, digits: number[]): { flags: boolean[] } | null {
  if (contract === "DIGITMATCH" || contract === "DIGITDIFF") {
    const digit = Number(barrier);
    if (!Number.isInteger(digit) || digit < 0 || digit > 9) return null;
    return { flags: digits.map((value) => value === digit) };
  }
  if (contract === "DIGITEVEN") return { flags: digits.map((value) => value % 2 === 0) };
  if (contract === "DIGITODD") return { flags: digits.map((value) => value % 2 === 1) };
  if (contract === "DIGITOVER" || contract === "DIGITUNDER") {
    const digit = Number(barrier);
    if (!Number.isInteger(digit)) return null;
    return { flags: digits.map((value) => digitWins(contract, barrier, value)) };
  }
  return null;
}

function holdout(flags: boolean[], minSample: number): { trials: number; hits: number; rate: number; lo: number } {
  if (flags.length < minSample + 20) return { trials: 0, hits: 0, rate: 0, lo: 0 };
  const cut = Math.floor(flags.length * 0.7);
  const tail = flags.slice(cut);
  const hits = tail.filter(Boolean).length;
  const wilson = wilsonInterval(hits, tail.length);
  return { trials: tail.length, hits, rate: tail.length ? hits / tail.length : 0, lo: wilson.lo };
}

function weightedRate(flags: boolean[], span: number): number | null {
  if (flags.length === 0) return null;
  const lambda = 2 / (Math.max(2, span) + 1);
  let mean = flags[0] ? 1 : 0;
  for (let i = 1; i < flags.length; i++) mean = lambda * (flags[i] ? 1 : 0) + (1 - lambda) * mean;
  return mean;
}

function quoteMath(stake?: number | null, payout?: number | null, probability?: number): { breakEven: number | null; expectedReturn: number | null } {
  const breakEven = stake != null && payout != null ? impliedProbability(payout, stake) : null;
  const expectedReturn = stake != null && payout != null && probability != null ? expectedValue(probability, payout, stake) : null;
  return { breakEven, expectedReturn };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
