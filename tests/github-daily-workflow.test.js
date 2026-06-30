"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildDailyArgs } = require("../scripts/github-daily-workflow");

test("buildDailyArgs uses safe workflow defaults", () => {
  assert.deepEqual(buildDailyArgs({}), [
    "daily",
    "--period",
    "daily",
    "--limit",
    "10",
    "--engine",
    "auto",
    "--commit",
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
      "--limit",
      "25",
      "--engine",
      "local",
      "--commit",
      "--date",
      "20260630",
    ]
  );
});
