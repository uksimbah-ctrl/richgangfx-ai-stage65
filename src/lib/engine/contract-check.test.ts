import assert from "node:assert/strict";
import test from "node:test";
import { analyzeBook } from "./analyze.ts";
import { checkDigitProposal, restoreDigitPick, streamsProposal } from "./contract-check.ts";
import { studyContract } from "./digit-stats.ts";
import { digitWins, lastDigit } from "./math.ts";
import { defaultModule, predictionAt } from "./modules.ts";
import { defaultProfile } from "./profiles.ts";
import { applySettlement } from "../desk/execution.ts";
import { forAccount } from "../desk/account-scope.ts";

function prices(digits: number[], falling = false): number[] {
  return digits.map((digit, index) => Number(((falling ? 800 - index * 0.1 : 100 + index * 0.1) + digit / 100).toFixed(2)));
}

function study(contract: string, digits: number[], barrier: string, minConfidence = 0.5) {
  return studyContract({
    contract,
    quotes: prices(digits),
    pip: 2,
    barrier,
    minSample: 80,
    minConfidence,
    strategy: "Statistical Probability",
    lookback: 40,
  });
}

test("matches and differs accept every digit from 0 to 9 and reject the rest", () => {
  for (const type of ["DIGITMATCH", "DIGITDIFF"] as const) {
    for (let digit = 0; digit <= 9; digit++) {
      const row = checkDigitProposal({
        contractType: type,
        symbol: "R_100",
        barrier: String(digit),
        duration: 1,
        durationUnit: "t",
        stake: 1,
        currency: "USD",
      });
      assert.equal(row.ok, true);
      if (row.ok) assert.equal(row.barrier, String(digit));
      assert.equal(digitWins(type, String(digit), digit), type === "DIGITMATCH");
      assert.equal(digitWins(type, String(digit), (digit + 1) % 10), type === "DIGITDIFF");
    }
    for (const barrier of ["", "10", "-1", "4.2", "x"]) {
      const row = checkDigitProposal({
        contractType: type,
        symbol: "R_100",
        barrier,
        duration: 1,
        durationUnit: "t",
        stake: 1,
        currency: "USD",
      });
      assert.equal(row.ok, false);
      if (!row.ok) assert.match(row.reason, /not sent|Nothing was sent/);
    }
  }
});

test("even, odd, over, and under keep their own barriers", () => {
  for (const type of ["DIGITEVEN", "DIGITODD"] as const) {
    const clean = checkDigitProposal({ contractType: type, symbol: "R_100", duration: 1, durationUnit: "t", stake: 1, currency: "USD" });
    assert.equal(clean.ok, true);
    if (clean.ok) assert.equal(clean.barrier, undefined);
    const barred = checkDigitProposal({ contractType: type, symbol: "R_100", barrier: "4", duration: 1, durationUnit: "t", stake: 1, currency: "USD" });
    assert.equal(barred.ok, false);
  }
  for (let digit = 0; digit <= 8; digit++) {
    const row = checkDigitProposal({ contractType: "DIGITOVER", symbol: "R_50", barrier: String(digit), duration: 5, durationUnit: "t", stake: 1, currency: "USD" });
    assert.equal(row.ok, true);
  }
  assert.equal(checkDigitProposal({ contractType: "DIGITOVER", symbol: "R_50", barrier: "9", duration: 5, durationUnit: "t", stake: 1, currency: "USD" }).ok, false);
  for (let digit = 1; digit <= 9; digit++) {
    const row = checkDigitProposal({ contractType: "DIGITUNDER", symbol: "R_50", barrier: String(digit), duration: 5, durationUnit: "t", stake: 1, currency: "USD" });
    assert.equal(row.ok, true);
  }
  assert.equal(checkDigitProposal({ contractType: "DIGITUNDER", symbol: "R_50", barrier: "0", duration: 1, durationUnit: "t", stake: 1, currency: "USD" }).ok, false);
  assert.equal(checkDigitProposal({ contractType: "DIGITMATCH", symbol: "bad symbol", barrier: "4", duration: 1, durationUnit: "t", stake: 1, currency: "USD" }).ok, false);
  assert.equal(checkDigitProposal({ contractType: "DIGITDIFF", symbol: "R_100", barrier: "4", duration: 0, durationUnit: "t", stake: 1, currency: "USD" }).ok, false);
  assert.equal(checkDigitProposal({ contractType: "DIGITMATCH", symbol: "R_100", barrier: "4", duration: 1, durationUnit: "ticks", stake: 1, currency: "USD" }).ok, false);
  assert.equal(checkDigitProposal({ contractType: "DIGITODD", symbol: "R_100", duration: 1, durationUnit: "t", stake: 0, currency: "USD" }).ok, false);
});

test("digit proposals are not streamed and a selected digit beats a saved barrier", () => {
  for (const type of ["DIGITEVEN", "DIGITODD", "DIGITOVER", "DIGITUNDER", "DIGITMATCH", "DIGITDIFF"]) {
    assert.equal(streamsProposal(type), false);
  }
  assert.equal(streamsProposal("CALL"), true);
  const quotes = prices(Array.from({ length: 120 }, (_, index) => index % 10));
  const plans = analyzeBook({
    symbol: "R_100",
    quotes,
    pipSize: 2,
    offered: [
      { contract_type: "DIGITMATCH", min_contract_duration: "1t", max_contract_duration: "10t" },
      { contract_type: "DIGITDIFF", min_contract_duration: "1t", max_contract_duration: "10t" },
    ],
    minSample: 20,
    phase: 0,
    stake: 1,
    digit: 7,
    profiles: {
      DIGITMATCH: { ...defaultProfile("DIGITMATCH"), barrier: "1" },
      DIGITDIFF: { ...defaultProfile("DIGITDIFF"), barrier: "2" },
    },
  });
  const match = plans.find((row) => row.type === "DIGITMATCH");
  const differ = plans.find((row) => row.type === "DIGITDIFF");
  assert.equal(match?.request?.barrier, "7");
  assert.equal(match?.request?.contract_type, "DIGITMATCH");
  assert.equal(match?.request?.duration_unit, "t");
  assert.equal(differ?.request?.barrier, "7");
  assert.equal(differ?.request?.contract_type, "DIGITDIFF");
  assert.notEqual(`${match?.request?.contract_type}|${match?.request?.barrier}`, `${differ?.request?.contract_type}|${differ?.request?.barrier}` || "same");
  const blank = analyzeBook({
    symbol: "R_100",
    quotes,
    pipSize: 2,
    offered: [{ contract_type: "DIGITMATCH", min_contract_duration: "1t", max_contract_duration: "10t" }],
    minSample: 20,
    phase: 0,
    stake: 1,
  });
  const waiting = blank.find((row) => row.type === "DIGITMATCH");
  assert.equal(waiting?.status, "stand-aside");
  assert.equal(waiting?.request, undefined);
  assert.match(waiting?.note ?? "", /Pick a digit/);
});

test("matches qualifies a hot digit, differs qualifies a rare digit, and a repeated digit does not", () => {
  const hot = Array.from({ length: 300 }, (_, index) => (index % 3 === 0 ? 7 : [0, 1, 2, 3, 4, 5, 6, 8, 9][index % 9]));
  const matched = study("DIGITMATCH", hot, "7");
  assert.equal(matched.status, "yes");
  assert.ok(matched.lo > 0.1);
  assert.match(matched.reason, /match 7/);
  assert.match(matched.reason, /not a guaranteed win rate/);
  const uniform = Array.from({ length: 300 }, (_, index) => index % 10);
  assert.equal(study("DIGITMATCH", uniform, "7").status, "no");
  assert.equal(study("DIGITDIFF", uniform, "7").status, "no");
  const absent = Array.from({ length: 500 }, (_, index) => [0, 1, 2, 3, 4, 5, 6, 8, 9][index % 9]);
  const differs = study("DIGITDIFF", absent, "7");
  assert.equal(differs.status, "yes");
  assert.ok(differs.lo > 0.9);
  assert.equal(study("DIGITMATCH", absent, "7").status, "no");
  const stuck = study("DIGITMATCH", Array.from({ length: 200 }, () => 2), "2");
  assert.equal(stuck.status, "wait");
  assert.match(stuck.reason, /repeated digit|not evidence/);
  assert.equal(study("DIGITDIFF", Array.from({ length: 200 }, () => 2), "7").status, "wait");
  const coldTail = hot.slice(0, 250).concat(Array.from({ length: 50 }, (_, index) => [0, 1, 2, 3, 4, 5, 6, 8, 9][index % 9]));
  assert.equal(study("DIGITMATCH", coldTail, "7").status, "wait");
});

test("a later tick cannot change an earlier matches prediction, and price direction is not the signal", () => {
  const digits = Array.from({ length: 280 }, (_, index) => (index % 3 === 0 ? 4 : [0, 1, 2, 3, 5, 6, 7, 8, 9][index % 9]));
  const quotes = prices(digits, true);
  assert.ok(quotes[quotes.length - 1] < quotes[0]);
  const cfg = { ...defaultModule("statistical"), enabled: true, minSample: 80, minConfidence: 0.5, lookback: 40 };
  const early = predictionAt("statistical", quotes, 220, cfg, 2, { type: "DIGITMATCH", barrier: "4" });
  const changed = quotes.slice();
  changed[260] = changed[260] + 4;
  const again = predictionAt("statistical", changed, 220, cfg, 2, { type: "DIGITMATCH", barrier: "4" });
  assert.equal(again, early);
  assert.equal(lastDigit(quotes[10], 2), digits[10]);
  const rising = study("DIGITMATCH", digits, "4");
  const falling = studyContract({
    contract: "DIGITMATCH",
    quotes,
    pip: 2,
    barrier: "4",
    minSample: 80,
    minConfidence: 0.5,
    strategy: "Statistical Probability",
    lookback: 40,
  });
  assert.equal(falling.status, rising.status);
  assert.equal(restoreDigitPick(4), 4);
  assert.equal(restoreDigitPick(4.2), null);
  assert.equal(restoreDigitPick(10), null);
  assert.equal(restoreDigitPick("4"), null);
});

test("settlement profit stays on the account that owns the digit contract", () => {
  const open = { status: "open", profit: undefined as number | undefined, payout: null as number | null, note: "", closedAt: undefined as number | undefined };
  const settled = applySettlement(open, { sold: true, profit: 0.84, payout: 1.84, closedAt: 20, audit: { profit: 0.84, payout: 1.84, isSold: true } });
  assert.equal(settled.status, "won");
  assert.equal(settled.profit, 0.84);
  const rows = [
    { accountId: "VRTC1", contractType: "DIGITMATCH", profit: 0.84, closedAt: 20 },
    { accountId: "CR9", contractType: "DIGITDIFF", profit: -1, closedAt: 20 },
  ];
  assert.equal(forAccount(rows, "VRTC1").length, 1);
  assert.equal(forAccount(rows, "CR9")[0]?.contractType, "DIGITDIFF");
  assert.equal(forAccount(rows, null).length, 0);
});
