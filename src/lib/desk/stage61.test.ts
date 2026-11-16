import assert from "node:assert/strict";
import test from "node:test";
import {
  assembleHistory,
  batchWouldExceed,
  blockingAttempt,
  createAttempt,
  markUncertain,
  maySubmit,
  reconcileAttempt,
  rejectPurchase,
  retainAttempt,
  type BuyAttempt,
  type ContractEvidence,
} from "./execution.ts";
import { canManageContract } from "./account-scope.ts";

function attempt(partial: Partial<BuyAttempt> = {}): BuyAttempt {
  return createAttempt({
    id: partial.id ?? "buy-1",
    accountId: partial.accountId ?? "CR1",
    accountType: partial.accountType ?? "real",
    contractType: partial.contractType ?? "DIGITEVEN",
    symbol: partial.symbol ?? "R_100",
    stake: partial.stake ?? 1,
    strategy: partial.strategy ?? "Even",
    signalKey: partial.signalKey ?? "R_100|DIGITEVEN",
    at: partial.at ?? 1_700_000_000_000,
    note: partial.note,
  });
}

function contract(partial: Partial<ContractEvidence> = {}): ContractEvidence {
  return {
    contractId: partial.contractId ?? "99",
    symbol: partial.symbol ?? "R_100",
    contractType: partial.contractType ?? "DIGITEVEN",
    buyPrice: partial.buyPrice === undefined ? 1 : partial.buyPrice,
    purchaseTime: partial.purchaseTime === undefined ? 1_700_000_000 : partial.purchaseTime,
    transactionId: partial.transactionId ?? null,
  };
}

test("a socket disconnect keeps the same attempt and does not allow another buy", () => {
  const pending = attempt({ id: "buy-9", accountId: "CR1" });
  const kept = retainAttempt(pending);
  assert.equal(kept.id, "buy-9");
  assert.equal(kept.accountId, "CR1");
  assert.equal(kept.status, "uncertain");
  assert.equal(maySubmit([kept], "CR1", kept.signalKey).ok, false);
  assert.equal(rejectPurchase(pending, "Socket closed.").retry, false);
  const notSent = rejectPurchase(pending, "Socket is not open.");
  assert.equal(notSent.attempt.status, "failed");
  assert.equal(notSent.retry, true);
  const again = retainAttempt(kept);
  assert.equal(again.id, kept.id);
  assert.equal(again.accountId, kept.accountId);
});

test("reconnection confirms the original purchase and a later pass does not create another", () => {
  const kept = retainAttempt(attempt({ id: "buy-9", accountId: "CR1" }));
  const found = reconcileAttempt({
    attempt: kept,
    portfolio: [contract({ contractId: "555", transactionId: "tx-9" })],
    history: [],
    knownIds: [],
    historyComplete: true,
  });
  assert.equal(found.attempt.id, "buy-9");
  assert.equal(found.attempt.accountId, "CR1");
  assert.equal(found.attempt.status, "confirmed");
  assert.equal(found.attempt.contractId, "555");
  assert.equal(found.retry, false);
  const second = reconcileAttempt({ attempt: found.attempt, portfolio: [], history: [], knownIds: ["555"] });
  assert.equal(second.attempt.id, "buy-9");
  assert.equal(second.attempt.contractId, "555");
  assert.equal(second.retry, false);
});

test("a late exact transaction id wins over a similar contract", () => {
  const pending = markUncertain({ ...attempt(), transactionId: "tx-right" }, "The buy response was lost.");
  const decision = reconcileAttempt({
    attempt: pending,
    portfolio: [],
    history: [
      contract({ contractId: "1", transactionId: "tx-other", purchaseTime: 1_700_000_010 }),
      contract({ contractId: "2", transactionId: "tx-right", purchaseTime: 1_700_000_020 }),
    ],
    knownIds: [],
    historyComplete: true,
  });
  assert.equal(decision.attempt.id, pending.id);
  assert.equal(decision.attempt.contractId, "2");
  assert.equal(decision.attempt.transactionId, "tx-right");
  assert.equal(decision.retry, false);
});

test("two similar purchases stay unresolved", () => {
  const pending = markUncertain(attempt(), "Checking.");
  const decision = reconcileAttempt({
    attempt: pending,
    portfolio: [
      contract({ contractId: "1", purchaseTime: 1_700_000_000 }),
      contract({ contractId: "2", purchaseTime: 1_700_000_030 }),
    ],
    history: [],
    knownIds: [],
    historyComplete: true,
  });
  assert.equal(decision.attempt.status, "uncertain");
  assert.equal(decision.attempt.contractId, undefined);
  assert.equal(decision.retry, false);
  assert.equal(maySubmit([decision.attempt], "CR1", pending.signalKey).ok, false);
  assert.equal(batchWouldExceed({ key: pending.signalKey, ids: ["open-1"] }, pending.signalKey, [decision.attempt], "CR1", 2), true);
});

test("a partial lookalike and an incomplete history are not a rejection", () => {
  const pending = markUncertain(attempt(), "Checking.");
  const partial = reconcileAttempt({
    attempt: pending,
    portfolio: [contract({ contractId: "1", purchaseTime: null, buyPrice: 1 })],
    history: [],
    knownIds: [],
    historyComplete: true,
  });
  assert.equal(partial.attempt.status, "uncertain");
  assert.equal(partial.attempt.contractId, undefined);
  const limited = reconcileAttempt({
    attempt: pending,
    portfolio: [],
    history: [],
    knownIds: [],
    historyComplete: false,
  });
  assert.equal(limited.retry, false);
  assert.equal(limited.attempt.status, "uncertain");
  assert.match(limited.attempt.note, /incomplete|not a rejection/);
  assert.equal(maySubmit([limited.attempt], pending.accountId, pending.signalKey).ok, false);
  const pages = assembleHistory([
    { rows: [contract({ contractId: "9" })], received: 50, limit: 50 },
  ]);
  assert.equal(pages.complete, false);
  const done = assembleHistory([
    { rows: [contract({ contractId: "9" })], received: 50, limit: 50 },
    { rows: [], received: 0, limit: 50 },
  ]);
  assert.equal(done.complete, true);
  assert.equal(done.rows?.length, 1);
  assert.deepEqual(assembleHistory(null), { rows: null, complete: false });
});

test("one similar contract in an incomplete history stays uncertain, an exact id does not", () => {
  const pending = markUncertain(attempt(), "Checking.");
  const lookalike = reconcileAttempt({
    attempt: pending,
    portfolio: [],
    history: [contract({ contractId: "77" })],
    knownIds: [],
    historyComplete: false,
  });
  assert.equal(lookalike.attempt.status, "uncertain");
  assert.equal(lookalike.attempt.contractId, undefined);
  assert.equal(lookalike.retry, false);
  assert.match(lookalike.attempt.note, /incomplete|not a rejection/);
  const exact = reconcileAttempt({
    attempt: markUncertain({ ...attempt(), transactionId: "tx-right" }, "The buy response was lost."),
    portfolio: null,
    history: [contract({ contractId: "2", transactionId: "tx-right" })],
    knownIds: [],
    historyComplete: false,
  });
  assert.equal(exact.attempt.id, pending.id);
  assert.equal(exact.attempt.contractId, "2");
  assert.equal(exact.attempt.transactionId, "tx-right");
  assert.equal(exact.retry, false);
});

test("switching accounts does not take over the other purchase", () => {
  const pending = markUncertain(attempt({ accountId: "CR1", signalKey: "batch" }), "Socket closed.");
  assert.equal(canManageContract("CR1", "VRTC1"), false);
  assert.equal(canManageContract("CR1", "CR1"), true);
  assert.equal(blockingAttempt([pending], "VRTC1", "batch"), null);
  assert.equal(maySubmit([pending], "CR1", "batch").ok, false);
  assert.equal(maySubmit([pending], "VRTC1", "batch").ok, true);
});
