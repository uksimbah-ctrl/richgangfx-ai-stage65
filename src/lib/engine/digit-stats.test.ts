import assert from "node:assert/strict";
import test from "node:test";
import { approvedEntry, defaultModule, defaultModules, explainDigits, forwardHit, readModule, walkModule } from "./modules.ts";
import { digitWins, fairDigit, lastDigit } from "./math.ts";
import { clearsBaseline, digitFrequencies, parityEpisodes, studyContract, wilsonFromFlags, wilsonInterval } from "./digit-stats.ts";

function pricesFromDigits(digits: number[], falling = false): number[] {
  let cents = falling ? 90000 : 10000;
  const out: number[] = [];
  for (const digit of digits) {
    cents += falling ? -1 : 1;
    let next = Math.floor(cents / 10) * 10 + digit;
    if (falling) while (next >= cents) next -= 10;
    else while (next <= cents) next += 10;
    cents = next;
    out.push(cents / 100);
  }
  return out;
}

function continuationDigits(blocks: number): number[] {
  const digits: number[] = [];
  for (let i = 0; i < blocks; i++) digits.push(0, 2, 4, 6, 1);
  digits.push(0, 2, 4, 8);
  return digits;
}

function fadeDigits(blocks: number): number[] {
  const digits: number[] = [];
  for (let i = 0; i < blocks; i++) digits.push(0, 2, 4, 1);
  digits.push(0, 2, 4);
  return digits;
}

test("last digits, parity, barriers, and contract baselines are not one coin flip", () => {
  assert.equal(lastDigit(540.14, 2), 4);
  assert.equal(lastDigit(538.8, 2), 0);
  assert.equal(digitWins("DIGITEVEN", "", 4), true);
  assert.equal(digitWins("DIGITODD", "", 4), false);
  assert.equal(digitWins("DIGITOVER", "7", 8), true);
  assert.equal(digitWins("DIGITOVER", "7", 7), false);
  assert.equal(digitWins("DIGITUNDER", "3", 2), true);
  assert.equal(digitWins("DIGITUNDER", "3", 3), false);
  assert.equal(digitWins("DIGITMATCH", "4", 4), true);
  assert.equal(digitWins("DIGITDIFF", "4", 4), false);
  assert.equal(fairDigit("DIGITEVEN", ""), 0.5);
  assert.equal(fairDigit("DIGITODD", ""), 0.5);
  assert.equal(fairDigit("DIGITOVER", "7"), 0.2);
  assert.equal(fairDigit("DIGITOVER", "1"), 0.8);
  assert.equal(fairDigit("DIGITUNDER", "3"), 0.3);
  assert.equal(fairDigit("DIGITMATCH", "4"), 0.1);
  assert.equal(fairDigit("DIGITDIFF", "4"), 0.9);
  assert.notEqual(fairDigit("DIGITOVER", "7"), fairDigit("DIGITOVER", "1"));
});

test("Wilson interval matches the score formula and an empty sample invents nothing", () => {
  const span = wilsonInterval(50, 100, 1.96);
  assert.ok(Math.abs(span.p - 0.5) < 1e-9);
  assert.ok(Math.abs(span.lo - 0.4038) < 0.01);
  assert.ok(Math.abs(span.hi - 0.5962) < 0.01);
  const empty = studyContract({
    contract: "DIGITEVEN",
    quotes: [],
    pip: 2,
    barrier: "",
    minSample: 80,
    minConfidence: 0.5,
    strategy: "Statistical Probability",
  });
  assert.equal(empty.status, "wait");
  assert.equal(empty.p, 0);
  assert.equal(empty.hits, 0);
  assert.match(empty.reason, /invented|Need/);
});

test("a constant run is one effective sample and overlapping streak windows are not extra episodes", () => {
  const flags = Array.from({ length: 200 }, () => true);
  const sample = wilsonFromFlags(flags);
  assert.equal(sample.n, 200);
  assert.equal(sample.nEff, 1);
  assert.ok(sample.lo < 0.5);
  const bits = Array.from({ length: 100 }, () => 0);
  const episodes = parityEpisodes(bits, 3);
  assert.equal(episodes.cases, 1);
  assert.equal(episodes.follow, 1);
});

test("a short sample waits, and invalid settings cannot qualify", () => {
  const quotes = pricesFromDigits([0, 2, 4, 6, 8, 1, 3]);
  const configs = defaultModules();
  configs.statistical = { ...defaultModule("statistical"), enabled: true, minSample: 80 };
  const waiting = approvedEntry("digit", "DIGITEVEN", quotes, configs, 2);
  assert.equal(waiting.ok, false);
  assert.match(waiting.reason, /WAIT|Need/);
  configs.statistical = { ...configs.statistical, minSample: 0 };
  const invalid = approvedEntry("digit", "DIGITEVEN", pricesFromDigits(Array.from({ length: 100 }, () => 2)), configs, 2);
  assert.equal(invalid.ok, false);
  assert.match(invalid.reason, /not a valid|Minimum sample|WAIT/);
  configs.streakFollow = { ...defaultModule("streakFollow"), enabled: true, minSample: 40, lookback: 0, minConfidence: 2 };
  const badStreak = approvedEntry("digit", "DIGITEVEN", pricesFromDigits(continuationDigits(30)), configs, 2);
  assert.equal(badStreak.agreed.includes("streakFollow"), false);
});

test("fade and follow use separate non-overlapping outcomes and do not veto each other", () => {
  const fadeQuotes = pricesFromDigits(fadeDigits(30));
  const followQuotes = pricesFromDigits(continuationDigits(30));
  const fadeCfg = { ...defaultModule("streakFade"), enabled: true, minSample: 40, lookback: 3, minConfidence: 0 };
  const followCfg = { ...defaultModule("streakFollow"), enabled: true, minSample: 40, lookback: 3, minConfidence: 0 };
  const fade = readModule("streakFade", fadeQuotes, fadeCfg, 2);
  const followOnFade = readModule("streakFollow", fadeQuotes, followCfg, 2);
  assert.equal(fade.bias, "down");
  assert.match(fade.reason, /Predicted Odd/);
  assert.equal(followOnFade.bias, "none");
  const follow = readModule("streakFollow", followQuotes, followCfg, 2);
  const fadeOnFollow = readModule("streakFade", followQuotes, fadeCfg, 2);
  assert.equal(follow.bias, "up");
  assert.equal(fadeOnFollow.bias, "none");
  const both = defaultModules();
  both.streakFade = fadeCfg;
  both.streakFollow = followCfg;
  both.ensemble.enabled = true;
  const retired = approvedEntry("digit", "DIGITEVEN", followQuotes, both, 2);
  assert.equal(retired.ok, false);
  assert.equal(retired.agreed.includes("streakFollow"), false);
  both.parity = { ...defaultModule("parity"), enabled: true, minSample: 40, lookback: 30, minConfidence: 0 };
  both.statistical = { ...defaultModule("statistical"), enabled: true, minSample: 500, lookback: 30 };
  const gate = approvedEntry("digit", "DIGITEVEN", followQuotes, both, 2);
  assert.equal(gate.ok, true);
  assert.ok(gate.agreed.includes("parity"));
  assert.equal(gate.agreed.includes("streakFollow"), false);
  assert.equal(gate.agreed.includes("statistical"), false);
  assert.match(gate.reason, /does not cancel|Ensemble note/);
});

test("digit walk-forward uses the next last digit, including over and under, not the price move", () => {
  const falling = pricesFromDigits(continuationDigits(40), true);
  assert.ok(falling[falling.length - 1] < falling[0]);
  const freq = digitFrequencies(falling, 2);
  assert.equal(freq.digits[0], 0);
  assert.equal(freq.last, 8);
  const follow = { ...defaultModule("streakFollow"), enabled: true, minSample: 40, lookback: 3, minConfidence: 0 };
  const report = walkModule("streakFollow", falling, follow, 1, 2);
  assert.ok(report.outTrials > 0);
  assert.ok((report.outSample ?? 0) > 0.5);
  const overDigits = Array.from({ length: 220 }, (_, i) => [8, 9, 7, 6, 1][i % 5]);
  const overPrices = pricesFromDigits(overDigits, true);
  const statistical = { ...defaultModule("statistical"), enabled: true, minSample: 40, lookback: 30, minConfidence: 0 };
  const over = walkModule("statistical", overPrices, statistical, 5, 2, { type: "DIGITOVER", barrier: "4" });
  assert.ok(over.outTrials > 0);
  assert.ok((over.outSample ?? 0) > 0.5);
  assert.equal(forwardHit("statistical", "up", overPrices[10], overPrices[11], 2, { type: "DIGITOVER", barrier: "4" }), digitWins("DIGITOVER", "4", lastDigit(overPrices[11], 2)));
  assert.equal(forwardHit("momentum", "up", 10, 9, 2), false);
  assert.equal(forwardHit("momentum", "down", 10, 9, 2), true);
  const early = readModule("streakFollow", falling.slice(0, 120), follow, 2);
  const changed = falling.slice();
  changed[changed.length - 1] = changed[changed.length - 1] - 0.07;
  const again = readModule("streakFollow", changed.slice(0, 120), follow, 2);
  assert.equal(again.bias, early.bias);
  assert.equal(again.reason, early.reason);
});

test("an estimate above the baseline is not enough, and the board does not invent a rate", () => {
  assert.equal(clearsBaseline(0.49, 0.5, 0.5), false);
  assert.equal(clearsBaseline(0.55, 0.5, 0.7), false);
  assert.equal(clearsBaseline(0.62, 0.5, 0.5), true);
  const flat = pricesFromDigits(Array.from({ length: 180 }, () => 2));
  const cfg = { ...defaultModule("statistical"), enabled: true, minSample: 40, minConfidence: 0.5 };
  const reading = readModule("statistical", flat, cfg, 2);
  assert.equal(reading.bias, "none");
  const configs = defaultModules();
  configs.statistical = cfg;
  const gate = approvedEntry("digit", "DIGITEVEN", flat, configs, 2);
  assert.equal(gate.ok, false);
  const card = explainDigits(flat, 2, "DIGITEVEN", "", configs);
  assert.equal(card.sample, 180);
  assert.match(card.reason, /not a guaranteed win rate|Not qualified|effective/);
  assert.doesNotMatch(card.reason, /certain|guaranteed to win/);
});
