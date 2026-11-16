import assert from "node:assert/strict";
import test from "node:test";
import {
  addOpenContract,
  applySettlement,
  batchWouldExceed,
  blockingAttempt,
  confirmAttempt,
  createAttempt,
  executionText,
  markFailed,
  markUncertain,
  maySubmit,
  reconcileAttempt,
  rejectPurchase,
  restoreAttempts,
  slotsUsed,
  subscriptionList,
  type BuyAttempt,
  type ContractEvidence,
  type SettlementAudit,
} from "./execution.ts";

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
    buyPrice: partial.buyPrice ?? 1,
    purchaseTime: partial.purchaseTime ?? 1_700_000_000,
    transactionId: partial.transactionId ?? "500",
  };
}

test("a successful buy creates one journal entry and a second copy does not", () => {
  const row = { contractId: "99", accountId: "CR1", status: "open" };
  const first = addOpenContract([], row);
  const second = addOpenContract(first.journal, row);
  assert.equal(first.added, true);
  assert.equal(first.journal.length, 1);
  assert.equal(second.added, false);
  assert.equal(second.journal.length, 1);
  const confirmed = confirmAttempt(attempt(), "99", "500");
  assert.equal(confirmAttempt(confirmed, "99", "500").status, "confirmed");
});

test("a delayed buy response does not open a second purchase", () => {
  const pending = attempt();
  assert.equal(maySubmit([pending], "CR1", pending.signalKey).ok, false);
  assert.equal(blockingAttempt([pending], "CR1", pending.signalKey)?.id, pending.id);
});

test("a lost response is uncertain and blocks another purchase", () => {
  const lost = markUncertain(attempt(), "The buy response was lost.");
  assert.equal(lost.status, "uncertain");
  const decision = reconcileAttempt({ attempt: lost, portfolio: null, history: null, knownIds: [] });
  assert.equal(decision.retry, false);
  assert.equal(decision.attempt.status, "uncertain");
  assert.equal(maySubmit([decision.attempt], "CR1", lost.signalKey).ok, false);
});

test("an empty or incomplete portfolio does not fail a purchase or release the lock", () => {
  const base = markUncertain(attempt(), "Checking.");
  const later = reconcileAttempt({ attempt: base, portfolio: [], history: [], knownIds: [], now: base.at + 120_000 });
  assert.equal(later.attempt.status, "uncertain");
  assert.equal(later.retry, false);
  assert.match(later.attempt.note, /not a rejection|stays unresolved/);
  assert.equal(maySubmit([later.attempt], "CR1", base.signalKey).ok, false);
  const incomplete = reconcileAttempt({ attempt: base, portfolio: null, history: [], knownIds: [] });
  assert.equal(incomplete.retry, false);
  assert.equal(incomplete.attempt.status, "uncertain");
  const partial = reconcileAttempt({ attempt: base, portfolio: [], history: null, knownIds: [] });
  assert.equal(partial.retry, false);
  assert.equal(partial.attempt.status, "uncertain");
});

test("a contract that arrives after the timeout confirms the original purchase", () => {
  const base = markUncertain(attempt(), "The buy response was lost.");
  const found = reconcileAttempt({
    attempt: base,
    portfolio: [],
    history: [contract({ contractId: "77", purchaseTime: Math.floor(base.at / 1000) + 20 })],
    knownIds: [],
    now: base.at + 120_000,
  });
  assert.equal(found.attempt.status, "confirmed");
  assert.equal(found.attempt.contractId, "77");
  assert.equal(found.retry, false);
  assert.equal(maySubmit([base], "CR1", base.signalKey).ok, false);
  assert.equal(maySubmit([found.attempt], "CR1", base.signalKey).ok, true);
});

test("only an explicit Deriv rejection can be retried", () => {
  const rejected = rejectPurchase(attempt(), "Insufficient balance.");
  assert.equal(rejected.attempt.status, "failed");
  assert.equal(rejected.retry, true);
  assert.equal(maySubmit([rejected.attempt], "CR1", rejected.attempt.signalKey).ok, true);
  const timeout = rejectPurchase(attempt(), "Deriv request timed out.");
  assert.equal(timeout.attempt.status, "uncertain");
  assert.equal(timeout.retry, false);
  assert.equal(maySubmit([timeout.attempt], "CR1", timeout.attempt.signalKey).ok, false);
  const dropped = rejectPurchase(markUncertain(attempt(), "Checking."), "Socket closed.");
  assert.equal(dropped.attempt.status, "uncertain");
  assert.equal(dropped.retry, false);
});

test("a confirmed purchase is not submitted again", () => {
  const confirmed = confirmAttempt(attempt(), "99", "500");
  const again = reconcileAttempt({ attempt: confirmed, portfolio: [], history: [], knownIds: ["99"] });
  assert.equal(again.retry, false);
  assert.equal(again.attempt.contractId, "99");
  assert.equal(maySubmit([confirmed], "CR1", confirmed.signalKey).ok, true);
  assert.equal(slotsUsed(1, [confirmed], "CR1"), 1);
});

test("missing settlement profit does not become a loss, and win, loss, and refund stay distinct", () => {
  const open: {
    status: string;
    profit?: number | null;
    payout: number | null;
    note: string;
    closedAt?: number;
    settlement?: SettlementAudit;
  } = { status: "open", profit: undefined, payout: null, note: "" };
  const missing = applySettlement(open, { sold: true, profit: null, payout: null, closedAt: 5, audit: { profit: null, payout: null, isSold: true } });
  assert.equal(missing.status, "open");
  assert.equal(missing.profit, undefined);
  assert.equal(missing.settlement?.isSold, true);
  assert.equal(missing.settlement?.profit, null);
  const won = applySettlement(open, { sold: true, profit: 0.95, payout: 1.95, closedAt: 5, audit: { profit: 0.95, payout: 1.95, isSold: true } });
  assert.equal(won.status, "won");
  assert.equal(won.profit, 0.95);
  const lost = applySettlement(open, { sold: true, profit: -1, payout: 0, closedAt: 5, audit: { profit: -1, payout: 0, isSold: true } });
  assert.equal(lost.status, "lost");
  const refund = applySettlement(open, { sold: true, profit: 0, payout: 1, closedAt: 5, audit: { profit: 0, payout: 1, isSold: true } });
  assert.equal(refund.status, "sold");
  const kept = applySettlement(won, { sold: true, profit: null, payout: null, closedAt: 9, audit: { profit: null, payout: null } });
  assert.equal(kept.status, "won");
  assert.equal(kept.profit, 0.95);
});

test("open contracts survive a reload and are restored once for their own account", () => {
  const saved = restoreAttempts([
    attempt({ id: "live", status: "submitting" as never }),
    { ...attempt({ id: "other", accountId: "VRTC9", accountType: "demo" }), status: "confirmed", contractId: "7" },
  ]);
  assert.equal(saved[0]?.status, "uncertain");
  assert.equal(saved[1]?.accountId, "VRTC9");
  assert.equal(saved[1]?.contractId, "7");
  const open = [
    { contractId: "7", accountId: "VRTC9" },
    { contractId: "8", accountId: "CR1" },
    { contractId: "8", accountId: "CR1" },
  ];
  assert.deepEqual(subscriptionList(open, "CR1"), ["8"]);
  assert.deepEqual(subscriptionList(open, "CR1", ["8"]), []);
  assert.deepEqual(subscriptionList(open, "VRTC9"), ["7"]);
});

test("a batch counts an uncertain purchase and does not grow past its size", () => {
  const pending = markUncertain(attempt({ signalKey: "same" }), "Checking.");
  const lock = { key: "same", ids: ["1", "2"] };
  assert.equal(batchWouldExceed(lock, "same", [pending], "CR1", 3), true);
  assert.equal(batchWouldExceed(lock, "same", [markFailed(pending, "Rejected.")], "CR1", 3), false);
  assert.equal(slotsUsed(2, [pending], "CR1"), 3);
  assert.equal(slotsUsed(0, [pending], "CR2"), 0);
});

test("reconciliation attaches the original contract and ignores another account's row", () => {
  const pending = markUncertain(attempt(), "Checking.");
  const found = reconcileAttempt({
    attempt: pending,
    portfolio: [contract({ contractId: "42", transactionId: "77" })],
    history: [],
    knownIds: [],
  });
  assert.equal(found.attempt.status, "confirmed");
  assert.equal(found.attempt.contractId, "42");
  assert.equal(found.attempt.transactionId, "77");
  assert.equal(found.retry, false);
  const other = reconcileAttempt({
    attempt: pending,
    portfolio: [contract({ contractId: "42", symbol: "R_50" })],
    history: [],
    knownIds: [],
  });
  assert.equal(other.attempt.status, "uncertain");
  assert.equal(other.retry, false);
});

test("execution text names the current state without offering another buy while uncertain", () => {
  const pending = markUncertain(attempt(), "Checking.");
  assert.match(executionText({ connected: true, trading: "live", attempt: pending }), /will not buy again/);
  assert.equal(executionText({ connected: true, trading: "connecting", attempt: pending }), "Recovery in progress.");
  assert.match(executionText({ connected: true, trading: "off", attempt: pending }), /Connection interrupted/);
  assert.equal(executionText({ connected: true, trading: "live", attempt: null }), "Ready to buy.");
  assert.equal(executionText({ connected: true, trading: "live", attempt: null, journalStatus: "open" }), "Contract open.");
  assert.equal(
    executionText({
      connected: true,
      trading: "live",
      attempt: { ...attempt(), status: "confirmed", contractId: "99" },
      journalStatus: "open",
      pendingSettlement: true,
    }),
    "Settlement pending.",
  );
  assert.equal(executionText({ connected: true, trading: "live", attempt: { ...attempt(), status: "settled" }, journalStatus: "won", profit: 1 }), "Won.");
  assert.equal(executionText({ connected: true, trading: "live", attempt: { ...attempt(), status: "settled" }, journalStatus: "lost", profit: -1 }), "Lost.");
  assert.equal(executionText({ connected: true, trading: "live", attempt: { ...attempt(), status: "settled" }, journalStatus: "sold", profit: 0 }), "Refunded or closed without profit or loss.");
});
