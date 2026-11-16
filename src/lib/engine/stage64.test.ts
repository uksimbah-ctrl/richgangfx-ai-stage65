import assert from "node:assert/strict";
import test from "node:test";
import { analyzeBook } from "./analyze.ts";
import { accountPerformance } from "../desk/account-stats.ts";
import { decideQuotePurchase, purchaseStillAuthorized } from "../desk/quote-exec.ts";
import { backtestCategories, backtestDigitEngine, digitQuoteBreakdown, NO_VERIFIED_EDGE, runDigitEngine } from "./digit-engines.ts";
import { digitWins, fairDigit, impliedProbability, lastDigit } from "./math.ts";
import { defaultModule, predictionAt } from "./modules.ts";
import { defaultProfile, entryBlock, fieldsFor, mergeProfile } from "./profiles.ts";
import { DEFAULT_RISK, tradeGate } from "./risk.ts";

function prices(digits: number[]): number[] {
  return digits.map((digit, index) => Number((100 + index * 0.1 + digit / 100).toFixed(2)));
}

function book(type: string, quotes: number[], extra: { digit?: number | null; profile?: ReturnType<typeof defaultProfile> } = {}) {
  return analyzeBook({
    symbol: "R_100",
    quotes,
    pipSize: 2,
    offered: [{ contract_type: type, min_contract_duration: "1t", max_contract_duration: "10t" }],
    minSample: 20,
    phase: 0,
    stake: 1,
    digit: extra.digit,
    profiles: extra.profile ? { [type]: extra.profile } : undefined,
  }).find((row) => row.type === type);
}

test("a blank Over barrier is not invented, and auto selection still has to qualify", () => {
  const quotes = prices(Array.from({ length: 80 }, (_, index) => index % 10));
  const off = book("DIGITOVER", quotes);
  assert.equal(off?.request, undefined);
  assert.equal(off?.status, "stand-aside");
  assert.match(off?.note ?? "", /SELECT A BARRIER/);
  assert.equal(defaultProfile("DIGITOVER").autoBarrier, false);
  assert.equal(defaultProfile("DIGITUNDER").autoBarrier, false);
  assert.ok(fieldsFor("DIGITOVER").includes("autoBarrier"));
  assert.equal(fieldsFor("DIGITMATCH").includes("autoBarrier"), false);

  const auto = book("DIGITOVER", quotes, { profile: { ...defaultProfile("DIGITOVER"), autoBarrier: true } });
  assert.equal(auto?.request, undefined);
  assert.match(auto?.note ?? "", /did not qualify/);
  assert.match(auto?.note ?? "", /No proposal was sent/);
  assert.doesNotMatch(auto?.note ?? "", /SELECT A BARRIER/);

  const picked = book("DIGITOVER", quotes, { digit: 5, profile: { ...defaultProfile("DIGITOVER"), autoBarrier: true, barrier: "2" } });
  assert.equal(picked?.request?.contract_type, "DIGITOVER");
  assert.equal(picked?.request?.barrier, "5");
  assert.equal(picked?.status, "pricing");

  const match = book("DIGITMATCH", quotes, { digit: 7, profile: { ...defaultProfile("DIGITMATCH"), barrier: "1" } });
  assert.equal(match?.request?.contract_type, "DIGITMATCH");
  assert.equal(match?.request?.barrier, "7");
  const differ = book("DIGITDIFF", quotes, { digit: 7 });
  assert.equal(differ?.request?.contract_type, "DIGITDIFF");
  assert.equal(differ?.request?.barrier, "7");
  assert.notEqual(match?.request?.contract_type, differ?.request?.contract_type);

  const even = book("DIGITEVEN", quotes);
  assert.equal(even?.request?.contract_type, "DIGITEVEN");
  assert.equal(even?.request?.barrier, undefined);
  const odd = book("DIGITODD", quotes);
  assert.equal(odd?.request?.contract_type, "DIGITODD");
  assert.equal(odd?.request?.barrier, undefined);

  const overNine = book("DIGITOVER", quotes, { digit: 9, profile: { ...defaultProfile("DIGITOVER"), autoBarrier: true } });
  assert.equal(overNine?.request, undefined);
  const underZero = book("DIGITUNDER", quotes, { profile: { ...defaultProfile("DIGITUNDER"), barrier: "0", autoBarrier: true } });
  assert.equal(underZero?.request, undefined);
  assert.match(underZero?.note ?? "", /SELECT A BARRIER|did not qualify|no tradable baseline/);
});

test("equality is a loss and each contract keeps its own baseline", () => {
  assert.equal(digitWins("DIGITOVER", "4", 4), false);
  assert.equal(digitWins("DIGITOVER", "4", 5), true);
  assert.equal(digitWins("DIGITUNDER", "4", 4), false);
  assert.equal(digitWins("DIGITUNDER", "4", 3), true);
  assert.equal(fairDigit("DIGITOVER", "0"), 0.9);
  assert.equal(fairDigit("DIGITOVER", "9"), 0);
  assert.equal(fairDigit("DIGITUNDER", "0"), 0);
  assert.equal(fairDigit("DIGITUNDER", "1"), 0.1);
  assert.equal(fairDigit("DIGITMATCH", "7"), 0.1);
  assert.equal(fairDigit("DIGITDIFF", "7"), 0.9);
  assert.equal(fairDigit("DIGITEVEN", ""), 0.5);
  assert.equal(fairDigit("DIGITODD", ""), 0.5);
  for (const contract of ["DIGITMATCH", "DIGITDIFF", "DIGITOVER", "DIGITUNDER", "DIGITEVEN", "DIGITODD"]) {
    const report = runDigitEngine({
      contract,
      quotes: prices(Array.from({ length: 30 }, (_, index) => index % 10)),
      pip: 2,
      barrier: contract === "DIGITEVEN" || contract === "DIGITODD" ? "" : "4",
      minSample: 20,
      minConfidence: 0.5,
      strategy: contract,
      persist: true,
    });
    assert.match(report.reason, /NO VERIFIED EDGE — INSUFFICIENT EVIDENCE/);
    assert.notEqual(report.status, "yes");
  }
});

test("Differs shows a full-stake loss and does not invent a missing payout", () => {
  const row = digitQuoteBreakdown({ ask: 1, payout: 1.05, probability: 0.95, contract: "DIGITDIFF" });
  assert.ok(Math.abs((row.netProfit ?? 0) - 0.05) < 1e-12);
  assert.equal(row.loss, 1);
  assert.equal(row.breakEven, 1 / 1.05);
  assert.equal(row.ratio, 1.05);
  const expected = 0.95 * 0.05 - 0.05 * 1;
  assert.ok(Math.abs((row.expectedReturn ?? 0) - expected) < 1e-12);
  assert.ok((row.expectedReturn ?? 0) < 0);
  assert.match(row.text, /90%/);
  assert.match(row.text, /full ask/);
  assert.match(row.text, new RegExp(NO_VERIFIED_EDGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(impliedProbability(1.05, 1), row.breakEven);

  const missing = digitQuoteBreakdown({ ask: 1, payout: null, probability: 0.9, contract: "DIGITDIFF" });
  assert.equal(missing.netProfit, null);
  assert.equal(missing.expectedReturn, null);
  assert.equal(missing.breakEven, null);
  assert.match(missing.text, /Neither was invented/);
  assert.doesNotMatch(missing.text, /1\.95|invented payout/);
});

test("current-payout simulation is labelled, and a flat sample is not an edge", () => {
  const cycle = Array.from({ length: 240 }, (_, index) => index % 10);
  const base = prices(cycle);
  const row = backtestDigitEngine({
    prices: base,
    pip: 2,
    contract: "DIGITDIFF",
    barrier: "7",
    stake: 1,
    payout: 1.05,
    minSample: 40,
    lookback: 20,
    engine: "DIGITDIFF",
  });
  assert.notEqual(row.verdict, "supported");
  assert.match(row.note, /SIMULATED USING CURRENT PAYOUT/);
  const lines = backtestCategories(row, base.length);
  assert.match(lines.join("\n"), /A\. Synthetic/);
  assert.match(lines.join("\n"), /Not market performance/);
  assert.match(lines.join("\n"), /B\. Historical tick simulation/);
  assert.match(lines.join("\n"), /C\. SIMULATED USING CURRENT PAYOUT/);
  assert.match(lines.join("\n"), /different payout/);
  assert.match(lines.join("\n"), /D\. Historical Deriv proposal performance is not available/);
  assert.match(lines.join("\n"), /Refunds 0/);
  assert.match(lines.join("\n"), /Unresolved 0/);
  assert.match(lines.join("\n"), /Trades executed 0/);
  assert.match(lines.join("\n"), new RegExp(NO_VERIFIED_EDGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const blank = backtestDigitEngine({ prices: base, pip: 2, contract: "DIGITOVER", barrier: "4", stake: 1, payout: null, minSample: 40, lookback: 20 });
  assert.equal(blank.oosEv, null);
  assert.equal(blank.net, null);
  assert.match(backtestCategories(blank, base.length).join(" "), /No historical payout was invented/);

  const changed = base.slice();
  changed[180] = Number((changed[180] + 0.07).toFixed(2));
  const early = predictionAt("selectedDigit", base, 120, { ...defaultModule("selectedDigit"), minSample: 40, lookback: 20, minConfidence: 0.5 }, 2, {
    type: "DIGITDIFF",
    barrier: "7",
  });
  const again = predictionAt("selectedDigit", changed, 120, { ...defaultModule("selectedDigit"), minSample: 40, lookback: 20, minConfidence: 0.5 }, 2, {
    type: "DIGITDIFF",
    barrier: "7",
  });
  assert.equal(again, early);
  assert.equal(lastDigit(base[10], 2), cycle[10]);
  const first = backtestDigitEngine({ prices: base.slice(0, 160), pip: 2, contract: "DIGITEVEN", barrier: "", stake: 1, payout: 1.9, minSample: 40, lookback: 20 });
  const longer = backtestDigitEngine({ prices: base, pip: 2, contract: "DIGITEVEN", barrier: "", stake: 1, payout: 1.9, minSample: 40, lookback: 20 });
  assert.ok(longer.checked >= first.checked);
  assert.ok(first.oosTrials <= first.decisions);
});

test("refunds stay out of the win rate, accounts stay apart, and a negative Differs quote is not a hidden block", () => {
  const rows = [
    { accountId: "VRTC1", accountType: "demo" as const, status: "won", profit: 0.05, closedAt: 1 },
    { accountId: "VRTC1", accountType: "demo" as const, status: "lost", profit: -1, closedAt: 2 },
    { accountId: "VRTC1", accountType: "demo" as const, status: "sold", profit: 0, closedAt: 3 },
    { accountId: "VRTC1", accountType: "demo" as const, status: "open", profit: null, closedAt: 4, settlement: { isSold: true } },
    { accountId: "CR1", accountType: "real" as const, status: "won", profit: 4, closedAt: 5 },
  ];
  const demo = accountPerformance(rows, "VRTC1");
  assert.equal(demo.wins, 1);
  assert.equal(demo.losses, 1);
  assert.equal(demo.refunds, 1);
  assert.equal(demo.unresolved, 1);
  assert.equal(demo.winRate, 0.5);
  assert.equal(accountPerformance(rows, "CR1").wins, 1);
  assert.equal(accountPerformance(rows, "CR1").losses, 0);
  assert.notEqual(demo.winRate, accountPerformance(rows, "CR1").winRate);

  const block = entryBlock(defaultProfile("DIGITDIFF"), {
    ev: -0.5,
    payout: 1.05,
    stake: 1,
    openForStrategy: 0,
    tradesToday: 0,
    dailyPnl: 0,
    consecutiveLosses: 5,
    exposure: null,
  });
  assert.equal(block, null);
  const gate = tradeGate({
    mode: "auto",
    intent: "auto",
    emergency: false,
    accountType: "demo",
    armDemo: true,
    armReal: false,
    ev: -0.5,
    stake: 1,
    openTrades: 0,
    dailyPnl: 0,
    consecutiveLosses: 5,
    balance: 50,
    equityPeak: 50,
    lastLossAt: null,
    now: 1_000_000,
    risk: { ...DEFAULT_RISK, cooldownSec: 0 },
  });
  assert.equal(gate.ok, true);
  assert.equal(gate.reasons.some((reason) => /expected value|negative/i.test(reason)), false);

  assert.equal(decideQuotePurchase({ source: "public", intent: "auto", streaming: false, proposalId: "p", blockers: [], mode: "auto", alreadyPurchased: false }).action, "skip");
  assert.equal(decideQuotePurchase({ source: "trading", intent: "auto", streaming: false, proposalId: "p", blockers: [], mode: "signal", alreadyPurchased: false }).action, "skip");
  assert.equal(decideQuotePurchase({ source: "trading", intent: "preview", streaming: false, proposalId: "p", blockers: [], mode: "auto", alreadyPurchased: false }).action, "skip");
  assert.equal(decideQuotePurchase({ source: "trading", intent: "auto", streaming: false, proposalId: "p", blockers: [], mode: "auto", alreadyPurchased: false }).action, "buy");
  assert.equal(
    purchaseStillAuthorized({ intent: "auto", capturedAccountId: "VRTC1", currentAccountId: "CR1", socketOpen: true, emergency: false, autoReady: true }).ok,
    false,
  );
  const restored = mergeProfile(defaultProfile("DIGITOVER"), { barrier: "3", stake: 1.2 });
  assert.equal(restored.autoBarrier, false);
  assert.equal(restored.barrier, "3");
  assert.equal(mergeProfile(defaultProfile("DIGITOVER"), { autoBarrier: true }).autoBarrier, true);
});
