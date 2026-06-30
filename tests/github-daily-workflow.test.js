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
    "--force",
    "--commit",
    "--allow-partial",
    "--concurrency",
    "25",
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
    }),
    [
      "daily",
      "--period",
      "yearly",
      "--engine",
      "local",
      "--force",
      "--commit",
      "--allow-partial",
      "--concurrency",
      "4",
      "--min-success-rate",
      "0.95",
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
