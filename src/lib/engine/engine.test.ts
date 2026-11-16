import assert from "node:assert/strict";
import test from "node:test";
import { adaptQuote, analyzeBook } from "./analyze.ts";
import { backtestDigit } from "./backtest.ts";
import { studyDigit } from "./digits.ts";
import { DEFAULT_RISK, orderStake, tradeGate } from "./risk.ts";
import { emaLast, readDirection, rsi } from "./indicators.ts";
import { expectedValue, fairDigit, lastDigit, touchProbability } from "./math.ts";

test("even money at a 1.95 payout is negative EV", () => {
  assert.ok(Math.abs(expectedValue(0.5, 1.95, 1) - -0.025) < 1e-9);
  assert.equal(fairDigit("DIGITEVEN", ""), 0.5);
  assert.equal(fairDigit("DIGITOVER", "7"), 0.2);
  assert.equal(fairDigit("DIGITUNDER", "3"), 0.3);
  assert.equal(fairDigit("DIGITMATCH", "4"), 0.1);
  assert.equal(fairDigit("DIGITDIFF", "4"), 0.9);
});

test("last digit uses the market precision", () => {
  assert.equal(lastDigit(540.14, 2), 4);
  assert.equal(lastDigit(538.8, 2), 0);
});

test("martingale stays off unless it is enabled, then respects the stake cap", () => {
  const first = orderStake(DEFAULT_RISK, 1000, 3);
  assert.equal(first, 1);
  const stepped = orderStake({ ...DEFAULT_RISK, martingale: true, martingaleMultiplier: 2, martingaleSteps: 3, maxStake: 5 }, 1000, 2);
  assert.equal(stepped, 4);
  const capped = orderStake({ ...DEFAULT_RISK, martingale: true, martingaleMultiplier: 2, martingaleSteps: 5, maxStake: 5 }, 1000, 4);
  assert.equal(capped, 5);
  const reset = orderStake({ ...DEFAULT_RISK, martingale: true, martingaleMultiplier: 2, martingaleSteps: 3 }, 1000, 0);
  assert.equal(reset, 1);
  const pct = orderStake({ ...DEFAULT_RISK, stakeMode: "percent", percentStake: 2, maxStake: 5 }, 1000);
  assert.equal(pct, 5);
});

test("risk gate blocks emergency, loss limit, and negative EV", () => {
  const base = {
    mode: "auto" as const,
    intent: "auto" as const,
    emergency: false,
    accountType: "demo" as const,
    armDemo: true,
    armReal: false,
    ev: 0.05,
    stake: 1,
    openTrades: 0,
    dailyPnl: 0,
    consecutiveLosses: 0,
    balance: 100,
    equityPeak: 100,
    lastLossAt: null,
    now: 1_000_000,
    risk: DEFAULT_RISK,
  };
  assert.equal(tradeGate(base).ok, true);
  assert.equal(tradeGate({ ...base, ev: -0.01 }).ok, true);
  assert.equal(tradeGate({ ...base, emergency: true }).ok, false);
  assert.equal(tradeGate({ ...base, dailyPnl: -20 }).ok, false);
  assert.equal(tradeGate({ ...base, accountType: "real" }).ok, false);
  assert.equal(tradeGate({ ...base, consecutiveLosses: 3 }).ok, true);
  assert.equal(tradeGate({ ...base, lastLossAt: base.now - 1_000 }).ok, false);
});

test("indicators stay finite and directional score is bounded", () => {
  const up: number[] = [];
  for (let i = 0; i < 240; i++) up.push(100 + i * 0.4);
  assert.ok((emaLast(up, 9) ?? 0) > 100);
  assert.ok((rsi(up, 14) ?? 0) > 60);
  const dir = readDirection(up);
  assert.ok(dir.score <= 1 && dir.score >= -1);
  assert.equal(dir.alignedUp, true);
  assert.equal(dir.alignedDown, false);
  assert.ok(touchProbability(0, 1, 10) === 1);
  assert.ok(touchProbability(5, 0.1, 2) < 0.2);
});

test("digit lower bound does not treat a short streak as an edge", () => {
  const mixed = Array.from({ length: 40 }, (_, i) => i % 10);
  const early = studyDigit({ digits: mixed, type: "DIGITEVEN", barrier: "", minSample: 150, prior: 200, z: 1.64 });
  assert.equal(early.ready, false);
  const hot = Array.from({ length: 400 }, () => 2);
  const blown = studyDigit({ digits: hot, type: "DIGITEVEN", barrier: "", minSample: 150, prior: 80, z: 1.28 });
  assert.equal(blown.ready, true);
  assert.ok(blown.lower > 0.8);
  const recentOnly = [...Array.from({ length: 180 }, () => 1), ...Array.from({ length: 50 }, () => 2)];
  const unstable = studyDigit({ digits: recentOnly, type: "DIGITEVEN", barrier: "", minSample: 100, prior: 80, z: 1.28 });
  assert.equal(unstable.windowsAgree, false);
  assert.equal(unstable.ready, false);
});

test("digit backtest counts the next tick and does not invent a payout", () => {
  const prices = [10.0, 10.12, 10.13, 10.14, 10.15];
  const report = backtestDigit({
    prices,
    pipSize: 2,
    type: "DIGITEVEN",
    barrier: "",
    payout: null,
    stake: 1,
  });
  assert.equal(report.trials, 4);
  assert.equal(report.perTradeEv, null);
  assert.equal(report.referenceRate, 0.5);
});

test("quote requests match what Deriv will accept", () => {
  const quotes: number[] = [];
  for (let i = 0; i < 240; i++) quotes.push(500 + i * 0.05);
  const plans = analyzeBook({
    symbol: "R_100",
    quotes,
    pipSize: 2,
    minSample: 100,
    phase: 0,
    stake: 1,
    digit: 3,
    offered: [
      { contract_type: "CALLE", min_contract_duration: "1t", max_contract_duration: "10t" },
      { contract_type: "PUTE", min_contract_duration: "1t", max_contract_duration: "10t" },
      { contract_type: "CALL", min_contract_duration: "1t", max_contract_duration: "10t" },
      { contract_type: "HIGHER", min_contract_duration: "5t", max_contract_duration: "10t" },
      { contract_type: "TURBOSLONG", min_contract_duration: "5t", max_contract_duration: "10t", barrier_choices: ["1.68", "2.95"] },
      { contract_type: "TURBOSSHORT", min_contract_duration: "5t", max_contract_duration: "10t", barrier_choices: ["1.68"] },
      { contract_type: "MULTUP", multiplier_range: [40, 100, 200] },
      { contract_type: "DIGITOVER", min_contract_duration: "1t", max_contract_duration: "10t", last_digit_range: [0, 1, 2, 3, 4] },
      { contract_type: "RUNHIGH", min_contract_duration: "2t", max_contract_duration: "5t" },
      { contract_type: "TICKHIGH", min_contract_duration: "5t", max_contract_duration: "5t" },
      { contract_type: "RESETCALL", min_contract_duration: "5t", max_contract_duration: "10t" },
    ],
  });
  const by = (type: string) => plans.find((plan) => plan.type === type);
  assert.equal(by("CALLE")?.request?.barrier, undefined);
  assert.equal(by("PUTE")?.request?.barrier, undefined);
  assert.equal(by("CALL")?.status, "pricing");
  assert.equal(by("CALL")?.request?.barrier, undefined);
  assert.equal(by("CALL")?.request?.duration_unit, "t");
  assert.ok((by("HIGHER")?.request?.barrier ?? "").startsWith("+"));
  assert.ok((by("TURBOSLONG")?.request?.barrier ?? "").startsWith("-"));
  assert.equal(by("MULTUP")?.request?.multiplier, 40);
  assert.equal(by("DIGITOVER")?.request?.barrier, "3");
  assert.ok((by("RUNHIGH")?.pCons ?? 1) <= 0.85 * 0.5 ** (by("RUNHIGH")?.request?.duration ?? 5) + 1e-9);
  assert.equal(by("TICKHIGH")?.request?.selected_tick, 1);
  assert.equal(by("RESETCALL")?.request?.barrier, undefined);
  const fixed = adaptQuote(
    { contract_type: "TURBOSLONG", barrier: "+1.68", duration: 5, duration_unit: "t" },
    "Barriers available are -1.68, -2.95, -5.19.",
  );
  assert.equal(fixed?.barrier, "-1.68");
  const dropped = adaptQuote(
    { contract_type: "CALLE", barrier: "+0.18", duration: 5, duration_unit: "t" },
    "Invalid barrier.",
  );
  assert.equal(dropped?.barrier, undefined);
});
