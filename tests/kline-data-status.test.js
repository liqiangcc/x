"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DataStatusService, buildDataStatus, latestDateFromFile } = require("../src/kline/data_status");

async function writeKline(root, period, code, dates) {
  const filePath = path.join(root, "kline", period, code.slice(0, 3), `${code}.json`);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify({ data: { klines: dates.map((date) => `${date},1,1,1,1,1,1,1,1,1,1`) } }));
}

test("data status reports latest coverage and strategy sync universe", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "x-data-status-"));
  context.after(() => fs.rm(root, { force: true, recursive: true }));
  await writeKline(root, "daily", "600001", ["2026-07-10", "2026-07-13"]);
  await writeKline(root, "daily", "000001", ["2026-07-10"]);
  await writeKline(root, "yearly", "600001", ["2025-12-31", "2026-07-13"]);
  const strategyFile = path.join(root, "strategy", "2026", "year-decline-close-breakout", "codes.json");
  await fs.mkdir(path.dirname(strategyFile), { recursive: true });
  await fs.writeFile(strategyFile, JSON.stringify({
    as_of_date: "2026-07-13",
    codes: ["600001"],
    generated_at: "2026-07-13T00:00:00Z",
    missing_yearly_count: 2,
    source_code_count: 100,
    strategy_id: "year-decline-close-breakout",
    target_year: 2026,
    total_codes: 1,
  }));

  const status = await buildDataStatus({ klineRoot: path.join(root, "kline"), strategyRoot: path.join(root, "strategy") });
  assert.equal(status.periods.daily.codeCount, 2);
  assert.equal(status.periods.daily.latestDate, "2026-07-13");
  assert.equal(status.periods.daily.latestDateCodeCount, 1);
  assert.equal(status.periods.yearly.latestDate, "2026-07-13");
  assert.equal(status.strategyUniverse.codeCount, 1);
  assert.equal(status.strategyUniverse.missingYearlyCount, 2);
  assert.equal(await latestDateFromFile(path.join(root, "kline", "daily", "600", "600001.json")), "2026-07-13");

  const service = new DataStatusService({ cacheTtlMs: 60000, klineRoot: path.join(root, "kline") });
  assert.equal(await service.get(), await service.get());
});
