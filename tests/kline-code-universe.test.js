"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildCodeUniverse } = require("../src/kline/code_universe");

test("generic code universe delegates selection without knowing strategy rules", async () => {
  const result = await buildCodeUniverse({
    asOfDate: "2026-07-13",
    codes: ["3", "1", "2", "2"],
    selector: { id: "test-selector", threshold: 2 },
    evaluateCode: async (code) => ({ eligible: Number(code) <= 2, reason: "above_threshold" }),
  });

  assert.deepEqual(result.codes, ["1", "2"]);
  assert.deepEqual(result.excluded_codes.above_threshold, ["3"]);
  assert.equal(result.source_code_count, 3);
});
