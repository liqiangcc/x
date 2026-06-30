"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildDailyArgs } = require("../scripts/github-daily-workflow");

test("buildDailyArgs uses safe workflow defaults", () => {
  assert.deepEqual(buildDailyArgs({}), [
    "daily",
    "--period",
    "daily",
    "--engine",
    "aws",
    "--universe",
    "market",
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

test("buildDailyArgs uses conservative yearly AWS defaults", () => {
  const args = buildDailyArgs({ PERIOD_INPUT: "yearly", ENGINE_INPUT: "aws" });

  assert.equal(args[args.indexOf("--concurrency") + 1], "1");
  assert.equal(args[args.indexOf("--retry-attempts") + 1], "5");
  assert.equal(args[args.indexOf("--retry-concurrency") + 1], "1");
  assert.equal(args[args.indexOf("--batch-size") + 1], "200");
});
