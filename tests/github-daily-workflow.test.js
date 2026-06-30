"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildDailyArgs,
  buildDispatchArgs,
  shouldDispatchNextRun,
} = require("../scripts/github-daily-workflow");

test("buildDailyArgs uses safe workflow defaults", () => {
  assert.deepEqual(buildDailyArgs({}), [
    "daily",
    "--period",
    "daily",
    "--engine",
    "aws",
    "--universe",
    "market",
    "--job-mode",
    "batch",
    "--commit",
    "--allow-partial",
    "--concurrency",
    "1",
    "--retry-attempts",
    "3",
    "--retry-concurrency",
    "1",
    "--batch-size",
    "500",
    "--min-success-rate",
    "0.95",
    "--latest",
  ]);
});

test("buildDailyArgs forwards explicit workflow inputs", () => {
  assert.deepEqual(
    buildDailyArgs({
      DATE_INPUT: "20260630",
      PERIOD_INPUT: "yearly",
      LIMIT_INPUT: "25",
      ENGINE_INPUT: "local",
      UNIVERSE_INPUT: "pool",
      FORCE_INPUT: "true",
    }),
    [
      "daily",
      "--period",
      "yearly",
      "--engine",
      "local",
      "--universe",
      "pool",
      "--job-mode",
      "batch",
      "--commit",
      "--allow-partial",
      "--concurrency",
      "4",
      "--retry-attempts",
      "0",
      "--retry-concurrency",
      "1",
      "--batch-size",
      "200",
      "--min-success-rate",
      "0.95",
      "--force",
      "--limit",
      "25",
      "--date",
      "20260630",
    ]
  );
});

test("buildDailyArgs omits empty workflow limit", () => {
  assert.equal(buildDailyArgs({ LIMIT_INPUT: "" }).includes("--limit"), false);
});

test("buildDailyArgs forwards chained job inputs", () => {
  const args = buildDailyArgs({
    JOB_MODE_INPUT: "batch",
    JOB_ID_INPUT: "20260630-daily-market-hs-a",
    CHAIN_DEPTH_INPUT: "2",
    MAX_CHAIN_DEPTH_INPUT: "20",
    AWS_REGION_INPUT: "ap-northeast-1,ap-southeast-1",
    LAMBDA_NAME_INPUT: "kline-prod",
    CONFIG_INPUT: "config/kline.json",
  });

  assert.equal(args[args.indexOf("--job-id") + 1], "20260630-daily-market-hs-a");
  assert.equal(args[args.indexOf("--chain-depth") + 1], "2");
  assert.equal(args[args.indexOf("--max-chain-depth") + 1], "20");
  assert.equal(args[args.indexOf("--aws-region") + 1], "ap-northeast-1,ap-southeast-1");
  assert.equal(args[args.indexOf("--lambda-name") + 1], "kline-prod");
  assert.equal(args[args.indexOf("--config") + 1], "config/kline.json");
});

test("buildDailyArgs uses conservative yearly AWS defaults", () => {
  const args = buildDailyArgs({ PERIOD_INPUT: "yearly", ENGINE_INPUT: "aws" });

  assert.equal(args[args.indexOf("--concurrency") + 1], "1");
  assert.equal(args[args.indexOf("--retry-attempts") + 1], "5");
  assert.equal(args[args.indexOf("--retry-concurrency") + 1], "1");
  assert.equal(args[args.indexOf("--batch-size") + 1], "200");
});

test("shouldDispatchNextRun only dispatches active GitHub batch jobs", () => {
  const run = {
    should_dispatch_next: true,
    job_mode: "batch",
    job_status: "running",
    chain_depth: 2,
    max_chain_depth: 10,
  };

  assert.equal(shouldDispatchNextRun(run, { GITHUB_ACTIONS: "true" }), true);
  assert.equal(shouldDispatchNextRun(run, { GITHUB_ACTIONS: "false" }), false);
  assert.equal(shouldDispatchNextRun({ ...run, job_status: "completed" }, { GITHUB_ACTIONS: "true" }), false);
  assert.equal(shouldDispatchNextRun({ ...run, chain_depth: 10 }, { GITHUB_ACTIONS: "true" }), false);
  assert.equal(
    shouldDispatchNextRun(run, { GITHUB_ACTIONS: "true", DISABLE_CHAIN_DISPATCH: "true" }),
    false
  );
});

test("buildDispatchArgs resumes the next batch with stable inputs", () => {
  const args = buildDispatchArgs(
    {
      aws_region: "ap-northeast-1,ap-southeast-1",
      batch_size: 500,
      chain_depth: 2,
      concurrency: "1",
      config: "config/kline.json",
      date: "20260630",
      engine: "aws",
      force: false,
      job_id: "20260630-daily-market-hs-a",
      lambda_name: "kline",
      max_chain_depth: 20,
      min_success_rate: "0.95",
      period: "daily",
      retry_attempts: "3",
      retry_concurrency: "1",
      universe: "market",
    },
    {
      GITHUB_REF_NAME: "master",
      GITHUB_WORKFLOW: "Daily Data Commit",
    }
  );

  assert.deepEqual(args.slice(0, 5), ["workflow", "run", "Daily Data Commit", "--ref", "master"]);
  assert.equal(args[args.indexOf("-f") + 1], "date=20260630");
  assert.equal(args.includes("chain_depth=3"), true);
  assert.equal(args.includes("job_id=20260630-daily-market-hs-a"), true);
  assert.equal(args.includes("aws_region=ap-northeast-1,ap-southeast-1"), true);
});
