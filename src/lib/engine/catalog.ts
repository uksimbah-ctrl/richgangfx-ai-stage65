export type Family =
  | "digit"
  | "directional"
  | "barrier"
  | "touch"
  | "range"
  | "asian"
  | "reset"
  | "ticks"
  | "vanilla"
  | "multiplier"
  | "accumulator"
  | "lookback"
  | "run"
  | "turbo";

export type ContractMeta = {
  type: string;
  name: string;
  family: Family;
  /** What the module actually does. Shown on the strategies desk. */
  summary: string;
};

export const CONTRACTS: ContractMeta[] = [
  {
    type: "DIGITOVER",
    name: "Over",
    family: "digit",
    summary:
      "Fair chance the last digit clears the barrier. Recent frequencies are a uniformity check only — they never raise the probability.",
  },
  {
    type: "DIGITUNDER",
    name: "Under",
    family: "digit",
    summary:
      "Fair chance the last digit lands under the barrier. A distorted sample stands the digit book aside instead of chasing it.",
  },
  {
    type: "DIGITDIFF",
    name: "Differs",
    family: "digit",
    summary: "The digit you pick. Statistical Probability uses that digit's complementary frequency. The barrier is not rotated.",
  },
  {
    type: "DIGITMATCH",
    name: "Matches",
    family: "digit",
    summary: "The digit you pick. Statistical Probability uses that digit's own frequency. The barrier is not rotated.",
  },
  {
    type: "DIGITEVEN",
    name: "Even",
    family: "digit",
    summary: "Even last digit. Probability is exactly one half.",
  },
  {
    type: "DIGITODD",
    name: "Odd",
    family: "digit",
    summary: "Odd last digit. Probability is exactly one half.",
  },
  {
    type: "CALL",
    name: "Rise",
    family: "directional",
    summary: "EMA, RSI, MACD, ADX, ATR and short price action must agree. The win probability is capped, then shrunk toward 50%.",
  },
  {
    type: "PUT",
    name: "Fall",
    family: "directional",
    summary: "Mirror of Rise. No trade unless the downtrend votes agree.",
  },
  {
    type: "HIGHER",
    name: "Higher",
    family: "barrier",
    summary: "Same trend gate as Rise, with a barrier set from recent tick volatility. Terminal probability uses a zero-drift normal.",
  },
  {
    type: "LOWER",
    name: "Lower",
    family: "barrier",
    summary: "Same trend gate as Fall, barrier set below spot from tick volatility.",
  },
  {
    type: "CALLE",
    name: "Higher or equal",
    family: "barrier",
    summary: "Directional gate plus a small upside barrier. Haircut applied to the terminal probability.",
  },
  {
    type: "PUTE",
    name: "Lower or equal",
    family: "barrier",
    summary: "Directional gate plus a small downside barrier.",
  },
  {
    type: "ONETOUCH",
    name: "Touch",
    family: "touch",
    summary: "Barrier distance, tick volatility and time to expiry. Touch odds use a reflection bound, then a haircut.",
  },
  {
    type: "NOTOUCH",
    name: "No Touch",
    family: "touch",
    summary: "Wins if the barrier is missed. The touch estimate is inflated first so a quiet tape cannot fake a no-touch edge.",
  },
  {
    type: "EXPIRYRANGE",
    name: "Ends Between",
    family: "range",
    summary: "Symmetric band from Bollinger width and tick sigma. Settlement probability is the terminal normal inside the band.",
  },
  {
    type: "EXPIRYMISS",
    name: "Ends Outside",
    family: "range",
    summary: "Opposite of Ends Between. Outside probability is one minus an inflated inside probability.",
  },
  {
    type: "RANGE",
    name: "Stays Between",
    family: "range",
    summary: "Path must remain inside a volatility band. Survival is discounted harder than a simple expiry range.",
  },
  {
    type: "UPORDOWN",
    name: "Goes Outside",
    family: "range",
    summary: "Touch of either band. Priced from the two-sided touch bound.",
  },
  {
    type: "EXPIRYRANGEE",
    name: "Ends Between (equal)",
    family: "range",
    summary: "Same band model as Ends Between.",
  },
  {
    type: "EXPIRYMISSE",
    name: "Ends Outside (equal)",
    family: "range",
    summary: "Same outside model as Ends Outside.",
  },
  {
    type: "RESETCALL",
    name: "Reset Call",
    family: "reset",
    summary: "Up-trend gate, with a tighter probability cap because the reset changes the payoff.",
  },
  {
    type: "RESETPUT",
    name: "Reset Put",
    family: "reset",
    summary: "Down-trend gate, same tighter cap as Reset Call.",
  },
  {
    type: "ASIANU",
    name: "Asian Up",
    family: "asian",
    summary: "Average-price up bet. Trend score is damped because the average is slower than the last tick.",
  },
  {
    type: "ASIAND",
    name: "Asian Down",
    family: "asian",
    summary: "Average-price down bet. Same damped trend score.",
  },
  {
    type: "TICKHIGH",
    name: "High Ticks",
    family: "ticks",
    summary: "Probability is capped at one over the tick count. A path bootstrap can only lower it.",
  },
  {
    type: "TICKLOW",
    name: "Low Ticks",
    family: "ticks",
    summary: "Same cap as High Ticks, on the lowest tick in the window.",
  },
  {
    type: "VANILLALONGCALL",
    name: "Vanilla Call",
    family: "vanilla",
    summary: "Longer-dated upside. Needs a trend agreement and a volatility barrier. Fixed-payout EV only.",
  },
  {
    type: "VANILLALONGPUT",
    name: "Vanilla Put",
    family: "vanilla",
    summary: "Longer-dated downside. Same barrier and haircut rules as the call.",
  },
  {
    type: "LBFLOATCALL",
    name: "Lookback Call",
    family: "lookback",
    summary: "Tracked when the symbol lists it. No buy unless the proposal has a fixed payout and conservative EV is positive.",
  },
  {
    type: "LBFLOATPUT",
    name: "Lookback Put",
    family: "lookback",
    summary: "Tracked when offered. Unknown or floating payoff is refused.",
  },
  {
    type: "LBHIGHLOW",
    name: "Lookback High-Low",
    family: "lookback",
    summary: "Tracked when offered. Refused when the quote has no fixed payout to value.",
  },
  {
    type: "MULTUP",
    name: "Multiplier Up",
    family: "multiplier",
    summary: "Smallest listed multiplier, stop-loss equal to stake, exposure cap. No Martingale. No buy without a positive model EV.",
  },
  {
    type: "MULTDOWN",
    name: "Multiplier Down",
    family: "multiplier",
    summary: "Down multiplier with the same exposure cap and stop.",
  },
  {
    type: "ACCU",
    name: "Accumulator",
    family: "accumulator",
    summary: "Smallest growth rate. Survival inside the growth band is estimated from tick sigma and then cut in half.",
  },
  {
    type: "RUNHIGH",
    name: "Only Ups",
    family: "run",
    summary: "Needs several positive ticks in a row. Bootstrap of recent deltas, haircut, fixed payout required.",
  },
  {
    type: "RUNLOW",
    name: "Only Downs",
    family: "run",
    summary: "Needs several negative ticks in a row. Same bootstrap and haircut.",
  },
  {
    type: "TURBOSLONG",
    name: "Turbo Long",
    family: "turbo",
    summary: "Knock-out distance versus tick volatility. Refused when exposure or EV cannot be shown.",
  },
  {
    type: "TURBOSSHORT",
    name: "Turbo Short",
    family: "turbo",
    summary: "Short turbo. Same knock-out distance test.",
  },
];

export const FAMILY_LABEL: Record<Family, string> = {
  digit: "Digits",
  directional: "Rise and fall",
  barrier: "Higher and lower",
  touch: "Touch",
  range: "Range",
  asian: "Asian",
  reset: "Reset",
  ticks: "Tick high and low",
  vanilla: "Vanilla",
  multiplier: "Multipliers",
  accumulator: "Accumulator",
  lookback: "Lookback",
  run: "Runs",
  turbo: "Turbos",
};

export const CONTRACT_BY_TYPE = new Map(CONTRACTS.map((c) => [c.type, c]));

export function contractName(type: string): string {
  return CONTRACT_BY_TYPE.get(type)?.name ?? type;
}
