"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  candidateIssues,
  evaluateMvpDataGate,
} = require("../src/simulator/data/data_gate");
const {
  createDataManifest,
  stableStringify,
} = require("../src/simulator/data/data_manifest");

const universe = {
  source: "market_universe_snapshot",
  securities: [{ code: "600001", market: 1 }],
  coverage: { validCount: 1 },
  qualityIssues: ["survivorship_bias_possible"],
};

test("MVP data gate allows available approximate data and exposes quality", () => {
  const result = evaluateMvpDataGate({
    asOfDate: "2026-07-01",
    universe,
    candidateInputs: [{
      candidateId: "candidate-a",
      yearlyHistory: { bars: [{}, {}, {}, {}], qualityIssues: [] },
      dailyHistory: { bars: [{}, {}], qualityIssues: [] },
    }],
    manifestInputs: [{ sourcePath: "data/a.json", contentHash: "aaa" }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.dataMode, "legacy_approximate");
  assert.deepEqual(result.blockingIssues, []);
  assert.equal(result.candidates[0].eligible, true);
  assert.equal(result.qualityIssues.includes("raw_execution_price_unavailable"), true);
  assert.equal(result.qualityIssues.includes("survivorship_bias_possible"), true);
  assert.match(result.manifest.manifestHash, /^[a-f0-9]{64}$/);
});

test("MVP data gate blocks an empty universe", () => {
  const result = evaluateMvpDataGate({
    asOfDate: "2026-07-01",
    universe: { securities: [], coverage: { validCount: 0 }, qualityIssues: [] },
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.blockingIssues, ["missing_available_universe"]);
});

test("candidate gate excludes insufficient history without blocking the session", () => {
  assert.deepEqual(candidateIssues({
    yearlyHistory: { bars: [{}, {}, {}], qualityIssues: [] },
    dailyHistory: { bars: [{}], qualityIssues: [] },
  }), ["insufficient_completed_years", "insufficient_current_year_history"]);
  const result = evaluateMvpDataGate({
    asOfDate: "2026-07-01",
    universe,
    candidateInputs: [{ candidateId: "candidate-a", yearlyHistory: { bars: [] }, dailyHistory: { bars: [] } }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.candidates[0].eligible, false);
});

test("execution gate blocks missing or non-positive next-open bars", () => {
  const result = evaluateMvpDataGate({
    asOfDate: "2026-07-01",
    universe,
    executionInputs: [{
      orderId: "order-a",
      executionEligible: false,
      qualityIssues: ["invalid_execution_price"],
    }],
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.blockingIssues, ["invalid_execution_price"]);
  assert.equal(result.executions[0].eligible, false);
});

test("data manifest is stable across input and object key order", () => {
  const left = createDataManifest({
    asOfDate: "2026-07-01",
    universe,
    inputs: [
      { sourcePath: "b.json", contentHash: "bbb" },
      { sourcePath: "a.json", contentHash: "aaa" },
    ],
  });
  const right = createDataManifest({
    asOfDate: "2026-07-01",
    universe: { coverage: { validCount: 1 }, source: "market_universe_snapshot" },
    inputs: [
      { contentHash: "aaa", sourcePath: "a.json" },
      { contentHash: "bbb", sourcePath: "b.json" },
    ],
  });
  assert.equal(left.manifestHash, right.manifestHash);
  assert.deepEqual(left.files.map((file) => file.sourcePath), ["a.json", "b.json"]);
  assert.equal(stableStringify({ b: 2, a: 1 }), "{\"a\":1,\"b\":2}");
});
