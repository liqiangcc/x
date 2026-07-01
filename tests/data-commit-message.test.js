"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { dataCommitMessage, formatBatchNumber } = require("../src/core/data_commit");

function sampleRun(overrides = {}) {
  return {
    batch_size: 300,
    chain_depth: 3,
    date: "20260701",
    engine: "aws-router",
    failed: 2,
    freshness_codes: 5191,
    freshness_source: "market_quote_available",
    job_id: "20260701-daily-market-hs-a",
    job_mode: "batch",
    job_status: "running",
    kline_engine_counts: { "aws-router": 298 },
    kline_failure_reason_counts: { stale_kline: 2 },
    kline_region_counts: { "us-east-1": 100 },
    kline_success_rate: 0.99,
    market: "hs-a",
    max_chain_depth: 20,
    period: "daily",
    progress_counts: { completed: 300, failed: 2, pending: 4891 },
    retried: 0,
    retry_failed: 0,
    retry_success: 0,
    run_id: "20260701T000000Z_daily",
    should_dispatch_next: true,
    skipped: 0,
    stale_completed: 2,
    success: 298,
    total: 300,
    universe: "market",
    universe_total_codes: 5534,
    expected_latest_date: "2026-07-01",
    ...overrides,
  };
}

test("formatBatchNumber uses one-based padded chain depth", () => {
  assert.equal(formatBatchNumber(sampleRun()), "004");
  assert.equal(formatBatchNumber(sampleRun({ job_mode: "single" })), null);
});

test("dataCommitMessage scopes titles by kline period", () => {
  assert.equal(
    dataCommitMessage(sampleRun(), { status: "ok" }).title,
    "data(daily): 20260701 batch 004 update market kline"
  );
  assert.equal(
    dataCommitMessage(sampleRun({ period: "yearly", chain_depth: 0 }), { status: "ok" }).title,
    "data(yearly): 20260701 batch 001 update market kline"
  );
});

test("dataCommitMessage records freshness context", () => {
  const message = dataCommitMessage(sampleRun(), { status: "ok" });

  assert.match(message.body, /expected_latest_date: 2026-07-01/);
  assert.match(message.body, /freshness_codes: 5191/);
  assert.match(message.body, /freshness_source: market_quote_available/);
  assert.match(message.body, /stale_completed: 2/);
  assert.match(message.body, /region_counts: \{"us-east-1":100\}/);
});
