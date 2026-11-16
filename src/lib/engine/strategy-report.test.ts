import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { writeFile } from "node:fs/promises";
import { analyzeBook } from "./analyze.ts";
import { CONTRACTS } from "./catalog.ts";
import { applyPreset, cappedStake, defaultBook, defaultProfile, profileFor } from "./profiles.ts";
import { DEFAULT_RISK, tradeGate } from "./risk.ts";
import { readStrategyBook, writeStrategyBook } from "../strategy/book-file.ts";

test("a preset does not rewrite risk limits", () => {
  const custom = {
    ...defaultProfile("DIGITOVER"),
    stake: 1.75,
    maxStake: 4,
    maxOpen: 2,
    cooldownSec: 45,
    dailyTradeLimit: 12,
    maxDailyLoss: 18,
    maxConsecutiveLosses: 4,
    maxExposure: 22,
    minPayout: 1.1,
  };
  for (const name of ["conservative", "balanced", "aggressive"] as const) {
    const next = applyPreset(custom, name);
    assert.equal(next.stake, custom.stake);
    assert.equal(next.maxStake, custom.maxStake);
    assert.equal(next.maxOpen, custom.maxOpen);
    assert.equal(next.cooldownSec, custom.cooldownSec);
    assert.equal(next.dailyTradeLimit, custom.dailyTradeLimit);
    assert.equal(next.maxDailyLoss, custom.maxDailyLoss);
    assert.equal(next.maxConsecutiveLosses, custom.maxConsecutiveLosses);
    assert.equal(next.maxExposure, custom.maxExposure);
    assert.equal(next.minPayout, custom.minPayout);
    assert.equal(next.minScore, name === "conservative" ? 0.35 : name === "balanced" ? 0.1 : 0);
  }
});

test("enabling a strategy does not authorize real-money trading", () => {
  const enabled = { ...defaultProfile("CALL"), enabled: true, status: "active" as const };
  assert.equal(enabled.enabled, true);
  const gate = tradeGate({
    mode: "auto",
    intent: "auto",
    emergency: false,
    accountType: "real",
    armDemo: true,
    armReal: false,
    ev: 1,
    stake: cappedStake(enabled, 1, DEFAULT_RISK.maxStake),
    openTrades: 0,
    dailyPnl: 0,
    consecutiveLosses: 0,
    balance: 100,
    equityPeak: 100,
    lastLossAt: null,
    now: 1_000_000,
    risk: DEFAULT_RISK,
  });
  assert.equal(gate.ok, false);
  assert.match(gate.reasons.join(" "), /Real-money trading is not armed/);
});

test("each strategy keeps the configuration that belongs to it", async () => {
  const quotes: number[] = [];
  for (let i = 0; i < 260; i++) quotes.push(400 + i * 0.08);
  const book = defaultBook();
  CONTRACTS.forEach((contract, index) => {
    book[contract.type] = {
      ...defaultProfile(contract.type),
      stake: Number((1 + index * 0.05).toFixed(2)),
      duration: (index % 9) + 1,
      durationUnit: "t",
      barrier: contract.family === "digit" ? String(index % 9) : "",
      minSample: 5,
      shortWindow: 5,
      rsiBuy: 50,
      rsiSell: 50,
      minAdx: 0,
      minScore: 0,
    };
  });
  const offered = CONTRACTS.map((contract) => ({
    contract_type: contract.type,
    min_contract_duration: "1t",
    max_contract_duration: "10t",
    multiplier_range: [20, 40, 60],
    growth_rate_range: [0.01, 0.02],
  }));
  const plans = analyzeBook({
    symbol: "R_100",
    quotes,
    pipSize: 2,
    offered,
    minSample: 5,
    phase: 0,
    stake: 1,
    profiles: book,
  });
  const lines = ["# Strategy configuration report", "", "Each row is the profile the engine read for that contract. A value from another contract is a failure.", ""];
  lines.push("| Contract | Stake | Duration | Barrier | Plan status | Request |");
  lines.push("|---|---:|---:|---|---|---|");
  for (const contract of CONTRACTS) {
    const own = profileFor(contract.type, book);
    const plan = plans.find((row) => row.type === contract.type);
    assert.equal(own.type, contract.type);
    assert.equal(own.stake, book[contract.type]?.stake);
    for (const other of CONTRACTS) {
      if (other.type === contract.type) continue;
      assert.notEqual(profileFor(other.type, book).stake, own.stake);
    }
    if (plan?.request && plan.status === "pricing") {
      assert.equal(plan.request.duration, own.duration);
      const usesBarrier = contract.type === "DIGITOVER" || contract.type === "DIGITUNDER" || contract.type === "DIGITMATCH" || contract.type === "DIGITDIFF";
      if (usesBarrier && own.barrier) assert.equal(plan.request.barrier, own.barrier);
    }
    const request = plan?.request ? `${plan.request.duration ?? "—"}${plan.request.duration_unit ?? ""} ${plan.request.barrier ?? ""}`.trim() : "—";
    lines.push(`| ${contract.name} | ${own.stake.toFixed(2)} | ${own.duration} | ${own.barrier || "—"} | ${plan?.status ?? "missing"} | ${request} |`);
  }
  lines.push("");
  lines.push("Real-money buys still require the account to be armed. Enabling a row does not arm it.");
  await writeFile("/workspace/artifacts/strategy-config-report.md", lines.join("\n"));
  const over = plans.find((row) => row.type === "DIGITOVER");
  const under = plans.find((row) => row.type === "DIGITUNDER");
  assert.equal(over?.request?.barrier, book.DIGITOVER?.barrier);
  assert.equal(under?.request?.barrier, book.DIGITUNDER?.barrier);
  assert.notEqual(over?.request?.barrier, under?.request?.barrier);
});

test("a saved book is still there after a fresh read", async () => {
  const dir = await mkdtemp(join(tmpdir(), "strategy-book-"));
  const file = join(dir, "strategy-profiles.json");
  try {
    const first = { ...defaultProfile("DIGITOVER"), barrier: "7", stake: 1.4, duration: 1, version: 3 };
    const second = { ...defaultProfile("CALL"), duration: 8, stake: 2, version: 2 };
    await writeStrategyBook({ DIGITOVER: first, CALL: second }, file);
    const loaded = await readStrategyBook(file);
    assert.equal(loaded.DIGITOVER?.barrier, "7");
    assert.equal(loaded.DIGITOVER?.stake, 1.4);
    assert.equal(loaded.CALL?.duration, 8);
    assert.equal(loaded.PUT, undefined);
    assert.notEqual(loaded.DIGITOVER?.stake, loaded.CALL?.stake);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
