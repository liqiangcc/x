"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  applyProgressResults,
  calculateMaxChainDepth,
  initializeProgress,
  normalizeProgress,
  selectProgressBatch,
  validateProgress,
} = require("../src/jobs/progress");

test("initializeProgress creates a complete pending queue", () => {
  const progress = initializeProgress({
    batchSize: 2,
    codes: ["600002", "600001", "600002"],
    date: "20260630",
    jobId: "daily-market",
    market: "hs-a",
    period: "daily",
    universe: "market",
  });

  assert.equal(progress.total_codes, 2);
  assert.deepEqual(progress.pending_codes, ["600001", "600002"]);
  assert.deepEqual(progress.completed_codes, []);
  assert.equal(progress.max_chain_depth, calculateMaxChainDepth(2, 2));
  validateProgress(progress);
});

test("selectProgressBatch covers pending codes before retrying failures", () => {
  const progress = initializeProgress({
    batchSize: 3,
    codes: ["600001", "600002", "600003", "600004"],
    date: "20260630",
    jobId: "daily-market",
    period: "daily",
    universe: "market",
  });
  const withFailure = {
    ...progress,
    pending_codes: ["600003", "600004"],
    completed_codes: ["600001"],
    failed_codes: ["600002"],
  };

  const selection = selectProgressBatch(withFailure);

  assert.deepEqual(selection.codes, ["600003", "600004", "600002"]);
  assert.equal(selection.source, "pending_then_failed");
});

test("applyProgressResults moves successes to completed and failures to retry queue", () => {
  const progress = initializeProgress({
    batchSize: 3,
    codes: ["600001", "600002", "600003"],
    date: "20260630",
    jobId: "daily-market",
    period: "daily",
    universe: "market",
  });
  const selected = {
    ...progress,
    last_batch_codes: ["600001", "600002"],
  };

  const updated = applyProgressResults(selected, {
    status: "completed_with_failures",
    total_codes: 2,
    success: 1,
    failed: 1,
    files: {
      "600001": { status: "success", engine: "aws", region: "ap-northeast-1" },
      "600002": { status: "failed", error_class: "transient_network" },
    },
  }, { chainDepth: 0 });

  assert.deepEqual(updated.completed_codes, ["600001"]);
  assert.deepEqual(updated.pending_codes, ["600003"]);
  assert.deepEqual(updated.failed_codes, ["600002"]);
  assert.equal(updated.status, "running");
  validateProgress(updated);
});

test("applyProgressResults treats skipped existing files as completed", () => {
  const progress = initializeProgress({
    batchSize: 2,
    codes: ["600001", "600002"],
    date: "20260630",
    jobId: "daily-market",
    period: "daily",
    universe: "market",
  });
  const updated = applyProgressResults({
    ...progress,
    last_batch_codes: ["600001", "600002"],
  }, {
    total_codes: 2,
    files: {
      "600001": { status: "skipped_existing" },
      "600002": { status: "migrated_existing" },
    },
  }, { chainDepth: 0 });

  assert.deepEqual(updated.completed_codes, ["600001", "600002"]);
  assert.deepEqual(updated.pending_codes, []);
  assert.deepEqual(updated.failed_codes, []);
  assert.equal(updated.status, "completed");
});

test("applyProgressResults blocks incomplete jobs at max chain depth", () => {
  const progress = initializeProgress({
    batchSize: 1,
    codes: ["600001"],
    date: "20260630",
    jobId: "daily-market",
    maxChainDepth: 1,
    period: "daily",
    universe: "market",
  });
  const updated = applyProgressResults({
    ...progress,
    last_batch_codes: ["600001"],
  }, {
    total_codes: 1,
    failed: 1,
    files: {
      "600001": { status: "failed", error_class: "transient_network" },
    },
  }, { chainDepth: 1 });

  assert.equal(updated.status, "blocked");
  assert.deepEqual(updated.failed_codes, ["600001"]);
});

test("normalizeProgress rejects duplicate code ownership", () => {
  assert.throws(
    () => normalizeProgress({
      all_codes: ["600001"],
      pending_codes: ["600001"],
      completed_codes: ["600001"],
      failed_codes: [],
      blocked_codes: [],
      batch_size: 1,
      chain_depth: 0,
      max_chain_depth: 1,
      total_codes: 1,
    }),
    /appears in both/
  );
});
