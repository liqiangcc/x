"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { analyzeNewHighs, yearlyPositivePct } = require("../src/stats/statistics");

test("yearlyPositivePct rejects non-whitelisted metric columns before opening sqlite", () => {
  assert.throws(
    () => yearlyPositivePct({ metricColumn: "c4; DROP TABLE py" }),
    /Invalid metric column/
  );
});

test("analyzeNewHighs rejects conflicting date filters before opening sqlite", () => {
  assert.throws(
    () => analyzeNewHighs({ year: "2026", date: "20260325" }),
    /cannot be used together/
  );
});
