import assert from "node:assert/strict";
import test from "node:test";
import { accountPerformance, dailyLossUsage, strategyRecord } from "./account-stats.ts";
import { filterJournal, tradeOutcome, type FilterableTrade } from "./journal-filter.ts";
import { systemHealth, type HealthInput } from "./health.ts";
import { flashText } from "./settings-flash.ts";
import { moduleScope, moduleSupports } from "../engine/modules.ts";

const base: FilterableTrade = {
  accountId: "VRTC1001",
  accountType: "demo",
  openedAt: Date.parse("2026-03-02T15:00:00Z"),
  closedAt: Date.parse("2026-03-02T15:01:00Z"),
  profit: 1.5,
  status: "won",
  contractType: "DIGITEVEN",
  symbol: "R_100",
  modules: ["streakFollow"],
};

function health(partial: Partial<HealthInput> = {}): HealthInput {
  return {
    feed: "live",
    trading: "live",
    hasAccount: true,
    accountType: "demo",
    armDemo: true,
    armReal: false,
    realArmedForAccount: false,
    emergency: false,
    tradeType: "DIGITEVEN",
    strategiesOn: 1,
    tickCount: 200,
    minSample: 80,
    openCount: 0,
    unresolved: 0,
    buyHold: null,
    ...partial,
  };
}

test("unresolved and missing profit are not losses", () => {
  const open: FilterableTrade = { ...base, status: "open", closedAt: undefined, profit: null };
  const pending: FilterableTrade = { ...open, settlement: { isSold: true } };
  const refund: FilterableTrade = { ...base, status: "sold", profit: 0 };
  assert.equal(tradeOutcome(open), "open");
  assert.equal(tradeOutcome(pending), "unresolved");
  assert.equal(tradeOutcome(refund), "refund");
  assert.equal(tradeOutcome({ ...base, profit: -2, status: "lost" }), "lost");
  const rows = [open, pending, refund, { ...base, profit: -2, status: "lost" }];
  const lost = filterJournal(rows, {
    accountKind: "all",
    accountId: "",
    from: "",
    to: "",
    contractType: "",
    strategy: "",
    symbol: "",
    outcome: "lost",
  });
  assert.equal(lost.length, 1);
  assert.equal(lost[0]?.profit, -2);
});

test("journal filters stay on the selected account, contract, strategy, and dates", () => {
  const other: FilterableTrade = { ...base, accountId: "CR2002", accountType: "real", symbol: "R_50", modules: ["pullback"], contractType: "CALL", openedAt: Date.parse("2026-03-03T12:00:00Z") };
  const rows = [base, other];
  const demo = filterJournal(rows, { accountKind: "demo", accountId: "", from: "", to: "", contractType: "", strategy: "", symbol: "", outcome: "all" });
  assert.deepEqual(demo.map((row) => row.accountId), ["VRTC1001"]);
  const exact = filterJournal(rows, { accountKind: "all", accountId: "CR2002", from: "2026-03-03", to: "2026-03-03", contractType: "CALL", strategy: "pullback", symbol: "R_50", outcome: "won" });
  assert.equal(exact.length, 1);
  const missed = filterJournal(rows, { accountKind: "all", accountId: "VRTC1001", from: "2026-03-04", to: "2026-03-04", contractType: "", strategy: "", symbol: "", outcome: "all" });
  assert.equal(missed.length, 0);
});

test("health is green only when the underlying check passed", () => {
  const ready = systemHealth(health());
  assert.equal(ready.every((row) => row.ok), true);
  const down = systemHealth(health({ feed: "down", trading: "off", hasAccount: false }));
  assert.equal(down.find((row) => row.id === "market")?.ok, false);
  assert.equal(down.find((row) => row.id === "execution")?.ok, false);
  assert.match(down.find((row) => row.id === "execution")?.detail ?? "", /No account/);
  const uncertain = systemHealth(health({ unresolved: 1, buyHold: "checking" }));
  assert.equal(uncertain.find((row) => row.id === "reconcile")?.ok, false);
  assert.equal(uncertain.find((row) => row.id === "execution")?.ok, false);
  const real = systemHealth(health({ accountType: "real", armReal: false, realArmedForAccount: false }));
  assert.equal(real.find((row) => row.id === "execution")?.ok, false);
  assert.match(real.find((row) => row.id === "execution")?.detail ?? "", /disarmed/);
  const thin = systemHealth(health({ tickCount: 3, minSample: 80 }));
  assert.equal(thin.find((row) => row.id === "history")?.ok, false);
  const unwatched = systemHealth(health({ trading: "off", openCount: 2, accountType: "demo" }));
  assert.equal(unwatched.find((row) => row.id === "monitoring")?.ok, false);
});

test("save text does not claim success after a failure", () => {
  assert.equal(flashText("saving"), "Saving…");
  assert.equal(flashText("saved"), "Saved successfully.");
  assert.equal(flashText("unsaved"), "Changes not saved.");
  assert.match(flashText("failed", "disk full"), /Save failed/);
  assert.doesNotMatch(flashText("failed"), /Saved successfully/);
});

test("streak strategies do not open digit trades", () => {
  assert.equal(moduleSupports("streakFade", "digit", "DIGITEVEN"), false);
  assert.equal(moduleSupports("streakFollow", "digit", "DIGITODD"), false);
  assert.equal(moduleSupports("streakFade", "digit", "DIGITOVER"), false);
  assert.equal(moduleSupports("parity", "digit", "DIGITEVEN"), true);
  assert.equal(moduleSupports("parity", "digit", "DIGITODD"), true);
  assert.equal(moduleSupports("parity", "digit", "DIGITMATCH"), false);
  assert.equal(moduleSupports("selectedDigit", "digit", "DIGITMATCH"), true);
  assert.equal(moduleSupports("selectedDigit", "digit", "DIGITEVEN"), false);
  assert.equal(moduleSupports("barrierProb", "digit", "DIGITOVER"), true);
  assert.equal(moduleSupports("barrierProb", "digit", "DIGITUNDER"), true);
  assert.equal(moduleSupports("barrierProb", "digit", "DIGITEVEN"), false);
  assert.equal(moduleSupports("statistical", "digit", "DIGITMATCH"), true);
  assert.equal(moduleSupports("statistical", "directional", "CALL"), false);
  assert.equal(moduleSupports("pullback", "directional", "CALL"), true);
  assert.match(moduleScope("ensemble"), /Advisory/);
  assert.match(moduleScope("regime"), /Descriptive/);
  assert.match(moduleScope("streakFade"), /Retired|does not open/);
});

test("dashboard figures stay on one account and do not invent a profit", () => {
  const other = { ...base, accountId: "CR2002", accountType: "real", profit: 9, modules: ["pullback"] };
  const unknown = { ...base, accountId: "", accountType: "demo", profit: 4 };
  const loss = { ...base, profit: -2, status: "lost", closedAt: Date.parse("2026-03-02T16:00:00Z") };
  const missing = { ...base, profit: null, status: "open", closedAt: undefined, settlement: { isSold: true } };
  const rows = [base, other, unknown, loss, missing];
  const stats = accountPerformance(rows, "VRTC1001", Date.parse("2026-03-02T18:00:00Z"), 0);
  assert.equal(stats.wins, 1);
  assert.equal(stats.losses, 1);
  assert.equal(stats.unresolved, 1);
  assert.equal(stats.totalPnl, -0.5);
  assert.equal(stats.todayPnl, -0.5);
  assert.equal(stats.avgWin, 1.5);
  assert.equal(stats.avgLoss, -2);
  assert.equal(stats.lossStreak, 1);
  const empty = accountPerformance([], "VRTC1001");
  assert.equal(empty.totalPnl, null);
  assert.equal(empty.todayPnl, null);
  assert.equal(empty.winRate, null);
  assert.equal(empty.avgWin, null);
  assert.equal(empty.avgLoss, null);
  assert.equal(empty.lossStreak, null);
  assert.deepEqual(dailyLossUsage(null, 20), { used: null, limit: 20, ratio: null });
  assert.equal(dailyLossUsage(-5, 20).used, 5);
  assert.equal(strategyRecord(rows, "CR2002", "pullback")?.trades, 1);
  assert.equal(strategyRecord(rows, "VRTC1001", "pullback"), null);
  assert.equal(strategyRecord(rows, "VRTC1001", "streakFollow")?.wins, 1);
  const real = accountPerformance(rows, "CR2002");
  assert.equal(real.totalPnl, 9);
  assert.equal(real.losses, 0);
});

