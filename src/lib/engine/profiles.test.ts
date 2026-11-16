import assert from "node:assert/strict";
import test from "node:test";
import { CONTRACTS } from "./catalog.ts";
import { analyzeBook } from "./analyze.ts";
import { applyPreset, defaultProfile, entryBlock, healthVerdict, releaseLossSuspension, validateProfile } from "./profiles.ts";

test("every contract has its own profile and a non-negative EV floor", () => {
  const seen = new Set<string>();
  for (const contract of CONTRACTS) {
    const profile = defaultProfile(contract.type);
    assert.equal(profile.type, contract.type);
    assert.ok(!seen.has(profile.type));
    seen.add(profile.type);
    assert.ok(profile.minEv >= 0);
    assert.equal(validateProfile(profile).length, 0);
    const aggressive = applyPreset(profile, "aggressive");
    assert.ok(aggressive.minEv >= 0);
    assert.ok(aggressive.stake <= aggressive.maxStake);
  }
});

test("a negative expected value does not block the selected strategy", () => {
  const profile = defaultProfile("CALL");
  const block = entryBlock(profile, {
    ev: -0.02,
    payout: 1.95,
    stake: 1,
    openForStrategy: 0,
    tradesToday: 0,
    dailyPnl: 0,
    consecutiveLosses: 0,
    exposure: null,
  });
  assert.equal(block, null);
});

test("duration and a disabled switch reach the strategy that owns them", () => {
  const quotes: number[] = [];
  for (let i = 0; i < 240; i++) quotes.push(500 + i * 0.05);
  const offered = [
    { contract_type: "CALL", min_contract_duration: "1t", max_contract_duration: "10t" },
    { contract_type: "DIGITEVEN", min_contract_duration: "1t", max_contract_duration: "1t" },
  ];
  const call = defaultProfile("CALL");
  call.duration = 3;
  const even = defaultProfile("DIGITEVEN");
  even.enabled = false;
  const plans = analyzeBook({
    symbol: "R_100",
    quotes,
    pipSize: 2,
    offered,
    minSample: 20,
    phase: 0,
    stake: 1,
    profiles: { CALL: call, DIGITEVEN: even },
  });
  const rise = plans.find((row) => row.type === "CALL");
  const digit = plans.find((row) => row.type === "DIGITEVEN");
  assert.equal(rise?.request?.duration, 3);
  assert.equal(digit?.status, "stand-aside");
  assert.match(digit?.note ?? "", /Disabled/);
});

test("a losing streak does not suspend the strategy", () => {
  const profile = defaultProfile("PUT");
  const verdict = healthVerdict(profile, { consecutiveLosses: 3, dailyPnl: 0 });
  assert.equal(verdict, null);
  const block = entryBlock(profile, {
    ev: 1,
    payout: 1.95,
    stake: 1,
    openForStrategy: 0,
    tradesToday: 0,
    dailyPnl: 0,
    consecutiveLosses: 6,
    exposure: null,
  });
  assert.equal(block, null);
  const held = { ...profile, status: "suspended" as const, suspendReason: "Suspended: consecutive-loss limit reached. Reactivate it yourself." };
  assert.equal(releaseLossSuspension(held).status, "active");
});
