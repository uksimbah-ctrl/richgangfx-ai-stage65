import assert from "node:assert/strict";
import test from "node:test";
import { digitWins, lastDigit } from "../engine/math.ts";
import { defaultModule, forwardHit, predictionAt, walkModule } from "../engine/modules.ts";
import { canManageContract, scopedWinRate } from "./account-scope.ts";
import { accountPerformance } from "./account-stats.ts";
import {
  batchWouldExceed,
  blockingAttempt,
  createAttempt,
  markFailed,
  markUncertain,
  maySubmit,
  reconcileAttempt,
  rejectPurchase,
  restoreAttempts,
  type BuyAttempt,
} from "./execution.ts";
import type { FilterableTrade } from "./journal-filter.ts";

function attempt(partial: Partial<BuyAttempt> = {}): BuyAttempt {
  return createAttempt({
    id: "buy-1",
    accountId: "CR1",
    accountType: "real",
    contractType: "DIGITEVEN",
    symbol: "R_100",
    stake: 1,
    strategy: "Even",
    signalKey: "R_100|DIGITEVEN",
    at: 1_700_000_000_000,
    ...partial,
  });
}

function pricesFromDigits(digits: number[]): number[] {
  let cents = 10000;
  return digits.map((digit) => {
    cents += 1;
    let next = Math.floor(cents / 10) * 10 + digit;
    while (next <= cents) next += 10;
    cents = next;
    return cents / 100;
  });
}

test("a purchase found after the timeout stays the original attempt", () => {
  const pending = markUncertain(attempt(), "The buy response was lost.");
  const empty = reconcileAttempt({
    attempt: pending,
    portfolio: [],
    history: [],
    knownIds: [],
    now: pending.at + 180_000,
  });
  assert.equal(empty.retry, false);
  assert.equal(empty.attempt.status, "uncertain");
  assert.equal(maySubmit([empty.attempt], "CR1", pending.signalKey).ok, false);
  const accepted = reconcileAttempt({
    attempt: empty.attempt,
    portfolio: [],
    history: [
      {
        contractId: "555",
        symbol: "R_100",
        contractType: "DIGITEVEN",
        buyPrice: 1,
        purchaseTime: Math.floor(pending.at / 1000) + 30,
        transactionId: "900",
      },
    ],
    knownIds: [],
    now: pending.at + 180_000,
  });
  assert.equal(accepted.attempt.status, "confirmed");
  assert.equal(accepted.attempt.id, pending.id);
  assert.equal(accepted.attempt.contractId, "555");
  assert.equal(accepted.retry, false);
});

test("an incomplete portfolio cannot release an uncertain purchase", () => {
  const pending = markUncertain(attempt(), "Checking.");
  const missingBook = reconcileAttempt({ attempt: pending, portfolio: null, history: null, knownIds: [], now: pending.at + 180_000 });
  assert.equal(missingBook.attempt.status, "uncertain");
  assert.equal(missingBook.retry, false);
  assert.equal(maySubmit([missingBook.attempt], pending.accountId, pending.signalKey).ok, false);
  assert.equal(batchWouldExceed({ key: pending.signalKey, ids: ["1"] }, pending.signalKey, [missingBook.attempt], "CR1", 2), true);
});

test("a definitive rejection fails the purchase and a timeout does not", () => {
  const rejected = rejectPurchase(attempt(), "Contract creation failed.");
  assert.equal(rejected.attempt.status, "failed");
  assert.equal(rejected.retry, true);
  const kept = reconcileAttempt({ attempt: rejected.attempt, portfolio: [], history: [], knownIds: [] });
  assert.equal(kept.attempt.status, "failed");
  assert.equal(kept.retry, false);
  const timedOut = rejectPurchase(attempt({ id: "buy-2" }), "Deriv request timed out.");
  assert.equal(timedOut.attempt.status, "uncertain");
  assert.equal(maySubmit([timedOut.attempt], "CR1", timedOut.attempt.signalKey).ok, false);
});

test("reconnect and refresh keep one unresolved purchase and do not open another", () => {
  const saved = restoreAttempts([{ ...attempt(), status: "submitting" }]);
  assert.equal(saved.length, 1);
  assert.equal(saved[0]?.status, "uncertain");
  assert.equal(maySubmit(saved, "CR1", saved[0]!.signalKey).ok, false);
  assert.equal(blockingAttempt(saved, "CR1", saved[0]!.signalKey)?.id, saved[0]?.id);
  assert.equal(maySubmit(saved, "VRTC9", saved[0]!.signalKey).ok, true);
});

test("win rate ignores refunds and unresolved trades and keeps accounts apart", () => {
  const demo: FilterableTrade[] = [
    { accountId: "VRTC1", accountType: "demo", status: "won", profit: 2, closedAt: 10 },
    { accountId: "VRTC1", accountType: "demo", status: "lost", profit: -1, closedAt: 11 },
    { accountId: "VRTC1", accountType: "demo", status: "sold", profit: 0, closedAt: 12 },
    { accountId: "VRTC1", accountType: "demo", status: "open", profit: null, closedAt: 13, settlement: { isSold: true } },
    { accountId: "CR9", accountType: "real", status: "won", profit: 50, closedAt: 14 },
    { accountId: "", accountType: "demo", status: "won", profit: 9, closedAt: 15 },
  ];
  const stats = accountPerformance(demo, "VRTC1");
  assert.equal(stats.wins, 1);
  assert.equal(stats.losses, 1);
  assert.equal(stats.refunds, 1);
  assert.equal(stats.unresolved, 1);
  assert.equal(stats.winRate, 0.5);
  assert.equal(scopedWinRate(demo, "VRTC1"), 0.5);
  const refundsOnly = accountPerformance(
    [{ accountId: "VRTC1", accountType: "demo", status: "sold", profit: 0, closedAt: 12 }],
    "VRTC1",
  );
  assert.equal(refundsOnly.winRate, null);
  assert.equal(refundsOnly.refunds, 1);
  assert.equal(accountPerformance(demo, "CR9").winRate, 1);
  assert.equal(accountPerformance(demo, "CR9").wins, 1);
  assert.equal(accountPerformance(demo, "").wins, 0);
});

test("future ticks cannot change an earlier digit prediction", () => {
  const digits: number[] = [];
  for (let i = 0; i < 40; i++) digits.push(0, 2, 4, 6, 1);
  const prices = pricesFromDigits(digits);
  const follow = { ...defaultModule("streakFollow"), enabled: true, minSample: 40, lookback: 3, minConfidence: 0 };
  const index = 102;
  const before = predictionAt("streakFollow", prices, index, follow, 2);
  assert.equal(before, "up");
  const mutated = prices.slice();
  for (let i = index + 1; i < mutated.length; i++) mutated[i] = Number(mutated[i].toFixed(2).slice(0, -1) + "1");
  assert.equal(predictionAt("streakFollow", mutated, index, follow, 2), before);
  const split = Math.floor(prices.length * 0.7);
  const tail = prices.slice();
  for (let i = split; i < tail.length; i++) tail[i] = Number(tail[i].toFixed(2).slice(0, -1) + "3");
  const original = walkModule("streakFollow", prices, follow, 1, 2);
  const changed = walkModule("streakFollow", tail, follow, 1, 2);
  assert.equal(changed.inSample, original.inSample);
  assert.ok(original.outTrials > 0);
  assert.ok(original.outTrials < prices.length / 4);
});

test("digit walk-forward scores even, odd, over, under, matches, and differs on the next tick", () => {
  const quote = (digit: number) => 100 + digit / 100;
  assert.equal(lastDigit(quote(4), 2), 4);
  assert.equal(lastDigit(quote(4), 0.01), 4);
  assert.equal(lastDigit(123.456, 3), 6);
  assert.equal(lastDigit(123.456, 0.001), 6);
  const score = (type: string, barrier: string, digit: number, bias: "up" | "down" = "up") =>
    forwardHit("statistical", bias, quote(0), quote(digit), 2, { type, barrier });
  assert.equal(score("DIGITEVEN", "", 4), true);
  assert.equal(score("DIGITEVEN", "", 3), false);
  assert.equal(forwardHit("statistical", "down", quote(0), quote(3), 2), true);
  assert.equal(forwardHit("statistical", "down", quote(0), quote(4), 2), false);
  assert.equal(score("DIGITOVER", "4", 5), true);
  assert.equal(score("DIGITOVER", "4", 4), false);
  assert.equal(score("DIGITUNDER", "4", 3), true);
  assert.equal(score("DIGITUNDER", "4", 4), false);
  assert.equal(score("DIGITMATCH", "7", 7), true);
  assert.equal(score("DIGITMATCH", "7", 6), false);
  assert.equal(score("DIGITDIFF", "7", 6), true);
  assert.equal(score("DIGITDIFF", "7", 7), false);
  assert.equal(digitWins("DIGITOVER", "4", lastDigit(quote(8), 2)), true);
});

test("account switching does not manage another account's contract or batch", () => {
  const pending = markUncertain(attempt({ accountId: "CR1", signalKey: "batch" }), "Checking.");
  assert.equal(canManageContract("CR1", "CR2"), false);
  assert.equal(canManageContract("CR1", "VRTC1"), false);
  assert.equal(blockingAttempt([pending], "CR2", "batch"), null);
  assert.equal(maySubmit([pending], "CR1", "batch").ok, false);
  assert.equal(batchWouldExceed({ key: "batch", ids: ["c1"] }, "batch", [pending], "CR1", 2), true);
  assert.equal(batchWouldExceed({ key: "batch", ids: ["c1"] }, "batch", [pending], "CR2", 2), false);
  assert.equal(markFailed(pending, "Rejected.").status, "failed");
});
