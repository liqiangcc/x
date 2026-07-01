"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { dataCommitPathspecs } = require("../src/core/data_paths");

test("dataCommitPathspecs limits daily commits to run-owned paths", () => {
  assert.deepEqual(
    dataCommitPathspecs({
      date: "20260701",
      job_id: "20260701-daily-market-hs-a",
      period: "daily",
      run_id: "20260701T000000Z_daily",
    }),
    [
      "data/kline/daily",
      "data/jobs/20260701/daily/20260701-daily-market-hs-a",
      "runs/20260701T000000Z_daily",
    ]
  );
});

test("dataCommitPathspecs excludes shared pool and universe roots", () => {
  const pathspecs = dataCommitPathspecs({
    date: "20260701",
    job_id: "20260701-yearly-market-hs-a",
    period: "yearly",
    run_id: "20260701T000000Z_yearly",
  });

  assert.equal(pathspecs.includes("data/universe"), false);
  assert.equal(pathspecs.includes("data/pool"), false);
  assert.equal(pathspecs.includes("data/kline/daily"), false);
  assert.equal(pathspecs.includes("data/kline/yearly"), true);
});
