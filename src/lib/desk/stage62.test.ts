import assert from "node:assert/strict";
import test from "node:test";
import { CONTRACT_BY_TYPE } from "../engine/catalog.ts";
import { checkDigitProposal, streamsProposal } from "../engine/contract-check.ts";
import { studyContract } from "../engine/digit-stats.ts";
import { moduleSupports, defaultModule } from "../engine/modules.ts";
import { approvedEntry } from "../engine/modules.ts";
import { DEFAULT_RISK, tradeGate } from "../engine/risk.ts";
import { realBuyAllowed } from "./account-scope.ts";
import { applySettlement, confirmAttempt, createAttempt, maySubmit, reconcileAttempt, retainAttempt } from "./execution.ts";
import {
  autoExecutionReady,
  buildProposalPayload,
  decideQuotePurchase,
  fulfillQuote,
  purchaseStillAuthorized,
  type ExecutionIntent,
  type QuotePurchaseInput,
  type QuoteSource,
} from "./quote-exec.ts";

const DIGITS = ["DIGITMATCH", "DIGITDIFF", "DIGITOVER", "DIGITUNDER", "DIGITEVEN", "DIGITODD"] as const;

function prices(digits: number[]): number[] {
  return digits.map((digit, index) => Number((100 + index * 0.1 + digit / 100).toFixed(2)));
}

function autoQuote(partial: Partial<QuotePurchaseInput> = {}): QuotePurchaseInput {
  return {
    source: "trading",
    intent: "auto",
    streaming: false,
    proposalId: "prop-1",
    blockers: [],
    mode: "auto",
    alreadyPurchased: false,
    ...partial,
  };
}

function barrierFor(type: string): string | undefined {
  if (type === "DIGITMATCH" || type === "DIGITDIFF") return "7";
  if (type === "DIGITOVER") return "3";
  if (type === "DIGITUNDER") return "4";
  return undefined;
}

test("each digit contract can auto-buy from a one-time trading proposal", async () => {
  for (const type of DIGITS) {
    assert.equal(streamsProposal(type), false);
    const barrier = barrierFor(type);
    const checked = checkDigitProposal({
      contractType: type,
      symbol: "R_100",
      barrier,
      duration: 1,
      durationUnit: "t",
      stake: 1,
      currency: "USD",
    });
    assert.equal(checked.ok, true, type);
    if (!checked.ok) continue;
    const payload = buildProposalPayload(
      {
        contract_type: type,
        duration: checked.duration,
        duration_unit: checked.durationUnit,
        barrier: checked.barrier,
      },
      "R_100",
      1,
      "USD",
      true,
    );
    assert.equal(payload.contract_type, type);
    assert.equal(payload.subscribe, undefined);
    assert.equal(payload.basis, "stake");
    assert.equal(payload.underlying_symbol, "R_100");
    if (type === "DIGITMATCH" || type === "DIGITDIFF") assert.equal(payload.barrier, "7");
    if (type === "DIGITOVER") assert.equal(payload.barrier, "3");
    if (type === "DIGITUNDER") assert.equal(payload.barrier, "4");
    if (type === "DIGITEVEN" || type === "DIGITODD") assert.equal(payload.barrier, undefined);
    const bought: Array<{ id: string; intent: ExecutionIntent }> = [];
    const decision = await fulfillQuote({
      seen: new Set(),
      quote: autoQuote({ proposalId: `prop-${type}`, streaming: false }),
      buy: async (id, intent) => {
        bought.push({ id, intent });
      },
    });
    assert.equal(decision.action, "buy");
    assert.deepEqual(bought, [{ id: `prop-${type}`, intent: "auto" }]);
  }
});

test("a one-time proposal in manual mode does not buy, and approval still can", async () => {
  for (const mode of ["scanner", "signal", "semi"] as const) {
    const bought: string[] = [];
    const decision = await fulfillQuote({
      seen: new Set(),
      quote: autoQuote({ mode, proposalId: `manual-${mode}` }),
      buy: async (id) => {
        bought.push(id);
      },
    });
    assert.equal(decision.action, "skip");
    assert.deepEqual(bought, []);
  }
  const approved: string[] = [];
  const decision = await fulfillQuote({
    seen: new Set(),
    quote: autoQuote({ intent: "approve", mode: "semi", proposalId: "prop-approve", streaming: false }),
    buy: async (id) => {
      approved.push(id);
    },
  });
  assert.equal(decision.action, "buy");
  assert.deepEqual(approved, ["prop-approve"]);
  const wrongMode = decideQuotePurchase(autoQuote({ intent: "approve", mode: "signal", proposalId: "nope" }));
  assert.equal(wrongMode.action, "skip");
});

test("a public market proposal and a proposal without an id cannot buy", () => {
  const pub = decideQuotePurchase(autoQuote({ source: "public" as QuoteSource, streaming: true, proposalId: "prop-public" }));
  assert.equal(pub.action, "skip");
  if (pub.action === "skip") assert.match(pub.reason, /public/i);
  const preview = decideQuotePurchase(autoQuote({ intent: "preview", source: "trading" }));
  assert.equal(preview.action, "skip");
  for (const proposalId of ["", "   ", null, undefined]) {
    const missing = decideQuotePurchase(autoQuote({ proposalId }));
    assert.equal(missing.action, "skip");
    if (missing.action === "skip") assert.match(missing.reason, /no id/i);
  }
});

test("duplicate proposal responses buy once", async () => {
  const seen = new Set<string>();
  const bought: string[] = [];
  const first = await fulfillQuote({
    seen,
    quote: autoQuote({ proposalId: "prop-dup" }),
    buy: async (id) => {
      bought.push(id);
    },
  });
  const second = await fulfillQuote({
    seen,
    quote: autoQuote({ proposalId: "prop-dup", alreadyPurchased: seen.has("prop-dup") }),
    buy: async (id) => {
      bought.push(id);
    },
  });
  assert.equal(first.action, "buy");
  assert.equal(second.action, "skip");
  assert.deepEqual(bought, ["prop-dup"]);
});

test("a changed account, a disarmed real account, and emergency stop cannot purchase", () => {
  const armed = {
    tradeType: "DIGITMATCH",
    mode: "auto" as const,
    emergency: false,
    trading: "live" as const,
    accountType: "real" as const,
    accountId: "CR1",
    armDemo: false,
    armReal: true,
    armedAccountId: "CR1",
  };
  assert.equal(autoExecutionReady(armed), true);
  assert.equal(autoExecutionReady({ ...armed, accountId: "CR2", armedAccountId: "CR1" }), false);
  assert.equal(autoExecutionReady({ ...armed, armReal: false }), false);
  assert.equal(autoExecutionReady({ ...armed, emergency: true }), false);
  assert.equal(autoExecutionReady({ ...armed, mode: "signal" }), false);
  assert.equal(realBuyAllowed({ accountType: "real", accountId: "CR2", armReal: false, armedAccountId: null }).ok, false);
  assert.equal(realBuyAllowed({ accountType: "real", accountId: "CR1", armReal: true, armedAccountId: "CR9" }).ok, false);
  const changed = purchaseStillAuthorized({
    intent: "auto",
    capturedAccountId: "CR1",
    currentAccountId: "CR2",
    socketOpen: true,
    emergency: false,
    autoReady: false,
  });
  assert.equal(changed.ok, false);
  const disarmed = purchaseStillAuthorized({
    intent: "auto",
    capturedAccountId: "CR1",
    currentAccountId: "CR1",
    socketOpen: true,
    emergency: false,
    autoReady: false,
  });
  assert.equal(disarmed.ok, false);
  const stopped = purchaseStillAuthorized({
    intent: "approve",
    capturedAccountId: "VRTC1",
    currentAccountId: "VRTC1",
    socketOpen: true,
    emergency: true,
    autoReady: false,
  });
  assert.equal(stopped.ok, false);
  const live = purchaseStillAuthorized({
    intent: "auto",
    capturedAccountId: "VRTC1",
    currentAccountId: "VRTC1",
    socketOpen: true,
    emergency: false,
    autoReady: true,
  });
  assert.equal(live.ok, true);
  const closed = purchaseStillAuthorized({
    intent: "auto",
    capturedAccountId: "VRTC1",
    currentAccountId: "VRTC1",
    socketOpen: false,
    emergency: false,
    autoReady: true,
  });
  assert.equal(closed.ok, false);
});

test("emergency stop and risk limits still block inside the trade gate", () => {
  const base = {
    mode: "auto" as const,
    intent: "auto" as const,
    emergency: false,
    accountType: "demo" as const,
    armDemo: true,
    armReal: false,
    ev: -0.05,
    stake: 1,
    openTrades: 0,
    dailyPnl: 0,
    consecutiveLosses: 4,
    balance: 100,
    equityPeak: 100,
    lastLossAt: null,
    now: 1_000_000,
    risk: DEFAULT_RISK,
  };
  assert.equal(tradeGate(base).ok, true);
  assert.equal(tradeGate({ ...base, emergency: true }).ok, false);
  assert.equal(tradeGate({ ...base, dailyPnl: -20 }).ok, false);
  assert.equal(tradeGate({ ...base, stake: 9 }).ok, false);
  assert.equal(tradeGate({ ...base, openTrades: 1 }).ok, false);
  assert.equal(tradeGate({ ...base, accountType: "real", armReal: false }).ok, false);
  assert.equal(tradeGate({ ...base, mode: "signal" }).ok, false);
});

test("an uncertain purchase is reconciled and not repeated", () => {
  const pending = retainAttempt(
    createAttempt({
      id: "buy-digit",
      accountId: "VRTC1",
      accountType: "demo",
      contractType: "DIGITMATCH",
      symbol: "R_100",
      stake: 1,
      strategy: "Matches",
      signalKey: "R_100|DIGITMATCH|7",
      at: 1_700_000_000_000,
    }),
  );
  assert.equal(pending.status, "uncertain");
  assert.equal(maySubmit([pending], "VRTC1", pending.signalKey).ok, false);
  const quote = decideQuotePurchase(autoQuote({ proposalId: "prop-later" }));
  assert.equal(quote.action, "buy");
  assert.equal(maySubmit([pending], "VRTC1", pending.signalKey).ok, false);
  const found = reconcileAttempt({
    attempt: pending,
    portfolio: [
      {
        contractId: "8841",
        symbol: "R_100",
        contractType: "DIGITMATCH",
        buyPrice: 1,
        purchaseTime: 1_700_000_000,
        transactionId: "tx-digit",
      },
    ],
    history: [],
    knownIds: [],
    historyComplete: true,
  });
  assert.equal(found.retry, false);
  assert.equal(found.attempt.id, "buy-digit");
  assert.equal(found.attempt.contractId, "8841");
  assert.equal(found.attempt.status, "confirmed");
  const settled = applySettlement(
    { status: "open", profit: undefined, payout: null, note: "", closedAt: undefined },
    { sold: true, profit: 0.84, payout: 1.84, closedAt: 20, audit: { profit: 0.84, payout: 1.84, isSold: true } },
  );
  assert.equal(settled.status, "won");
  const confirmed = confirmAttempt(pending, "8841", "tx-digit");
  assert.equal(confirmed.contractId, "8841");
});

test("streaming contracts still auto-buy and keep their own proposal fields", async () => {
  const families = [
    { type: "CALL", family: "directional", extra: {} },
    { type: "HIGHER", family: "barrier", extra: { barrier: "+0.12" } },
    { type: "ONETOUCH", family: "touch", extra: { barrier: "120" } },
    { type: "EXPIRYRANGE", family: "range", extra: { barrier: "+0.2", barrier2: "-0.2" } },
    { type: "ASIANU", family: "asian", extra: {} },
    { type: "RESETCALL", family: "reset", extra: {} },
    { type: "ACCU", family: "accumulator", extra: { growth_rate: 0.01 } },
  ];
  for (const row of families) {
    assert.equal(streamsProposal(row.type), true, row.type);
    const payload = buildProposalPayload(
      { contract_type: row.type, duration: 5, duration_unit: "t", ...row.extra },
      "R_100",
      1,
      "USD",
      true,
    );
    assert.equal(payload.subscribe, 1, row.type);
    assert.equal(payload.contract_type, row.type);
    if ("barrier" in row.extra) assert.equal(payload.barrier, row.extra.barrier);
    const bought: string[] = [];
    const decision = await fulfillQuote({
      seen: new Set(),
      quote: autoQuote({ proposalId: `stream-${row.type}`, streaming: true }),
      buy: async (id) => {
        bought.push(id);
      },
    });
    assert.equal(decision.action, "buy", row.type);
    assert.deepEqual(bought, [`stream-${row.type}`]);
    const held = decideQuotePurchase(autoQuote({ source: "public", streaming: true, proposalId: `public-${row.type}` }));
    assert.equal(held.action, "skip");
  }
  const pricedOnly = buildProposalPayload({ contract_type: "CALL", duration: 5, duration_unit: "t" }, "R_50", 1, "USD", false);
  assert.equal(pricedOnly.subscribe, undefined);
});

test("matches and differs keep the selected digit and do not use a rotated barrier", () => {
  const match = CONTRACT_BY_TYPE.get("DIGITMATCH");
  const differ = CONTRACT_BY_TYPE.get("DIGITDIFF");
  assert.match(match?.summary ?? "", /digit you pick/i);
  assert.match(differ?.summary ?? "", /digit you pick/i);
  assert.doesNotMatch(match?.summary ?? "", /rotates the barrier/i);
  assert.doesNotMatch(differ?.summary ?? "", /rotates the barrier/i);
  assert.match(match?.summary ?? "", /not rotated/i);
  assert.equal(moduleSupports("statistical", "digit", "DIGITMATCH"), true);
  assert.equal(moduleSupports("statistical", "digit", "DIGITDIFF"), true);
  assert.equal(moduleSupports("streakFade", "digit", "DIGITMATCH"), false);
  assert.equal(moduleSupports("streakFollow", "digit", "DIGITDIFF"), false);
  const hot = Array.from({ length: 300 }, (_, index) => (index % 3 === 0 ? 7 : [0, 1, 2, 3, 4, 5, 6, 8, 9][index % 9]));
  const quotes = prices(hot);
  const studied = studyContract({
    contract: "DIGITMATCH",
    quotes,
    pip: 2,
    barrier: "7",
    minSample: 80,
    minConfidence: 0.5,
    strategy: "Statistical Probability",
    lookback: 40,
  });
  assert.equal(studied.status, "yes");
  assert.match(studied.reason, /match 7/);
  const short = studyContract({
    contract: "DIGITDIFF",
    quotes: prices([1, 2, 3, 4]),
    pip: 2,
    barrier: "7",
    minSample: 80,
    minConfidence: 0.5,
    strategy: "Statistical Probability",
    lookback: 40,
  });
  assert.equal(short.status, "wait");
  assert.match(short.reason, /Need 80 ticks/);
  const cfg = { ...defaultModule("statistical"), enabled: true, status: "active" as const };
  const book = { statistical: cfg };
  const entry = approvedEntry("digit", "DIGITMATCH", quotes, book, 2, "7");
  assert.equal(entry.ok, true);
  assert.deepEqual(entry.agreed, ["statistical"]);
  const streakOnly = approvedEntry(
    "digit",
    "DIGITMATCH",
    quotes,
    { streakFade: { ...defaultModule("streakFade"), enabled: true, status: "active" } },
    2,
    "7",
  );
  assert.equal(streakOnly.ok, false);
  assert.match(streakOnly.reason, /Statistical Probability/);
});
