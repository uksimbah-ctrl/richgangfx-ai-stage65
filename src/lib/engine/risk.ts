import { roundStake } from "./math.ts";

export type StakeMode = "fixed" | "percent";
export type TradeMode = "scanner" | "signal" | "semi" | "auto";
export type AccountKind = "demo" | "real";

export type ResearchMode = "conservative" | "balanced" | "aggressive";

export type RiskConfig = {
  stakeMode: StakeMode;
  fixedStake: number;
  percentStake: number;
  maxStake: number;
  maxOpenTrades: number;
  dailyLossLimit: number;
  dailyProfitTarget: number;
  maxConsecutiveLosses: number;
  maxDrawdownPct: number;
  cooldownSec: number;
  minEdge: number;
  minSample: number;
  /** Stake × multiplier cannot exceed this. Not a Martingale step. */
  maxMultiplierExposure: number;
  /** Starting research preset. It is not a claim that the preset is profitable. */
  researchMode: ResearchMode;
  /** Off by default. When on, stake grows after losses and resets after a win. */
  martingale: boolean;
  martingaleMultiplier: number;
  martingaleSteps: number;
};

export const DEFAULT_RISK: RiskConfig = {
  stakeMode: "fixed",
  fixedStake: 1,
  percentStake: 1,
  maxStake: 5,
  maxOpenTrades: 1,
  dailyLossLimit: 20,
  dailyProfitTarget: 40,
  maxConsecutiveLosses: 3,
  maxDrawdownPct: 10,
  cooldownSec: 60,
  minEdge: 0.01,
  minSample: 150,
  maxMultiplierExposure: 25,
  researchMode: "balanced",
  martingale: false,
  martingaleMultiplier: 2,
  martingaleSteps: 3,
};

/** Prior strength and interval width. These are research defaults, not fitted edges. */
export function researchProfile(mode: ResearchMode): { prior: number; z: number; minSample: number; minEdge: number } {
  if (mode === "conservative") return { prior: 400, z: 1.96, minSample: 300, minEdge: 0.02 };
  if (mode === "aggressive") return { prior: 80, z: 1.28, minSample: 80, minEdge: 0 };
  return { prior: 200, z: 1.64, minSample: 150, minEdge: 0.01 };
}

/**
 * Base stake, unless Martingale is on. Steps reset when the loss streak is 0.
 * The result never exceeds the maximum stake.
 */
export function orderStake(risk: RiskConfig, balance: number | null, losses = 0): number | null {
  const cap = Math.max(0, risk.maxStake);
  let stake: number;
  if (risk.stakeMode === "fixed") {
    stake = roundStake(Math.min(Math.max(0, risk.fixedStake), cap));
  } else {
    if (balance == null || !(balance > 0)) return null;
    const raw = (Math.max(0, risk.percentStake) / 100) * balance;
    stake = roundStake(Math.min(raw, cap));
  }
  if (!(stake > 0)) return null;
  if (!risk.martingale || losses <= 0) return stake;
  const steps = Math.min(Math.max(0, Math.floor(losses)), Math.max(0, Math.floor(risk.martingaleSteps || 0)));
  const mult = Math.max(1, risk.martingaleMultiplier || 1);
  const sized = roundStake(Math.min(stake * mult ** steps, cap));
  return sized > 0 ? sized : null;
}

export type GateInput = {
  mode: TradeMode;
  intent: "price" | "approve" | "auto";
  emergency: boolean;
  accountType: AccountKind | null;
  armDemo: boolean;
  armReal: boolean;
  ev: number | null;
  stake: number | null;
  openTrades: number;
  dailyPnl: number;
  consecutiveLosses: number;
  balance: number | null;
  equityPeak: number | null;
  lastLossAt: number | null;
  now: number;
  risk: RiskConfig;
  exposure?: number | null;
  /** Digit contracts the user explicitly chose. The payout is below fair odds, so EV stays negative. */
  allowNegativeEv?: boolean;
};

export function tradeGate(input: GateInput): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const { risk } = input;
  if (input.emergency) reasons.push("Emergency stop is on.");
  if (input.intent === "auto" && input.mode !== "auto") {
    reasons.push("Full auto is off.");
  }
  if (input.intent === "approve" && input.mode !== "semi") {
    reasons.push("Semi-auto approval is off.");
  }
  if (input.accountType == null) reasons.push("No trading account is connected.");
  if (input.accountType === "demo" && !input.armDemo) reasons.push("Demo trading is not armed.");
  if (input.accountType === "real" && !input.armReal) reasons.push("Real-money trading is not armed.");
  if (input.stake == null || !(input.stake > 0)) reasons.push("Stake is not set.");
  if (input.stake != null && input.stake > risk.maxStake) reasons.push("Stake is above the maximum.");
  if (input.openTrades >= risk.maxOpenTrades) reasons.push("Open-trade limit reached.");
  if (input.dailyPnl <= -Math.abs(risk.dailyLossLimit)) reasons.push("Daily loss limit reached.");
  if (input.dailyPnl >= Math.abs(risk.dailyProfitTarget)) reasons.push("Daily profit target reached.");
  if (
    input.balance != null &&
    input.equityPeak != null &&
    input.equityPeak > 0 &&
    ((input.equityPeak - input.balance) / input.equityPeak) * 100 >= risk.maxDrawdownPct
  ) {
    reasons.push("Drawdown limit reached.");
  }
  if (
    input.lastLossAt != null &&
    input.now - input.lastLossAt < risk.cooldownSec * 1000
  ) {
    reasons.push("Cooldown is still running.");
  }
  if (input.exposure != null && input.exposure > risk.maxMultiplierExposure) {
    reasons.push("Multiplier exposure is above the cap.");
  }
  return { ok: reasons.length === 0, reasons };
}
