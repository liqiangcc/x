"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { buildStrategyUniverse } = require("../src/kline/strategy_universe");

async function writeYearly(root, code, closes) {
  const filePath = path.join(root, "yearly", code.slice(0, 3), `${code}.json`);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify({
    data: {
      code,
      klines: closes.map((close, index) => `${2022 + index}-12-31,${close + 1},${close},${close + 2},${close - 1},1,1,1,1,1,1`),
    },
  }));
}

test("strategy universe uses completed yearly bars to reduce today's sync codes", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "x-strategy-universe-"));
  context.after(() => fs.rm(root, { force: true, recursive: true }));
  await writeYearly(root, "600001", [20, 18, 16, 14]);
  await writeYearly(root, "000001", [10, 11, 9, 8]);
  const outputFile = path.join(root, "strategy", "codes.json");

  const result = await buildStrategyUniverse({
    asOfDate: "2026-07-13",
    codes: ["600001", "000001", "300001"],
    klineRoot: root,
    outputFile,
  });

  assert.deepEqual(result.codes, ["600001"]);
  assert.deepEqual(result.missing_yearly_codes, ["300001"]);
  assert.equal(result.source_code_count, 3);
  assert.equal(result.total_codes, 1);
  assert.equal(result.required_completed_years, 4);
  assert.deepEqual((JSON.parse(await fs.readFile(outputFile, "utf8"))).codes, ["600001"]);

  const reused = await buildStrategyUniverse({
    asOfDate: "20260713",
    codes: ["300001", "600001", "000001"],
    klineRoot: root,
    outputFile,
  });
  assert.equal(reused.reused, true);
});
