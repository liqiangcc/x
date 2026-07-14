"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { aggregateYearRows, aggregateYearlyFromDaily } = require("../src/kline/aggregate_yearly");

function row(date, open, close, high, low, volume, amount, turnover) {
  return { amount, close, date, high, low, open, turnover, volume };
}

test("daily rows aggregate into one current-year OHLC bar", () => {
  const value = aggregateYearRows([
    row("2026-01-02", 10, 11, 12, 9, 100, 1000, 1),
    row("2026-07-13", 11, 15, 16, 10, 200, 3000, 2),
  ], { previousClose: 8, targetYear: 2026 });
  assert.equal(value, "2026-07-13,10,15,16,9,300,4000,87.5,87.5,7,3");
});

test("aggregation updates only codes with the target daily bar and preserves older yearly bars", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "x-aggregate-yearly-"));
  context.after(() => fs.rm(root, { force: true, recursive: true }));
  const dailyFile = path.join(root, "daily", "600", "600001.json");
  const yearlyFile = path.join(root, "yearly", "600", "600001.json");
  await fs.mkdir(path.dirname(dailyFile), { recursive: true });
  await fs.mkdir(path.dirname(yearlyFile), { recursive: true });
  await fs.writeFile(dailyFile, JSON.stringify({ data: { code: "600001", market: 1, klines: [
    "2025-12-31,8,8,8,8,10,80,0,0,0,1",
    "2026-01-02,10,11,12,9,100,1000,0,0,0,1",
    "2026-07-13,11,15,16,10,200,3000,0,0,0,2",
  ] } }));
  await fs.writeFile(yearlyFile, JSON.stringify({ data: { code: "600001", market: 1, klines: [
    "2025-12-31,9,8,10,7,1000,8000,0,0,0,8",
    "2026-07-10,10,14,15,9,250,3500,0,0,0,2.5",
  ] } }));

  const summary = await aggregateYearlyFromDaily({ codes: ["600001", "000001"], klineRoot: root, targetDate: "20260713" });
  assert.equal(summary.updated, 1);
  assert.equal(summary.skipped, 1);
  const payload = JSON.parse(await fs.readFile(yearlyFile, "utf8"));
  assert.equal(payload.data.klines.length, 2);
  assert.match(payload.data.klines[1], /^2026-07-13,10,15,16,9,300,4000,/);
  assert.equal(payload.meta.aggregated_from, "daily");
});

test("historical aggregation never replaces a newer current-year bar", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "x-aggregate-no-regress-"));
  context.after(() => fs.rm(root, { force: true, recursive: true }));
  const dailyFile = path.join(root, "daily", "600", "600001.json");
  const yearlyFile = path.join(root, "yearly", "600", "600001.json");
  await fs.mkdir(path.dirname(dailyFile), { recursive: true });
  await fs.mkdir(path.dirname(yearlyFile), { recursive: true });
  await fs.writeFile(dailyFile, JSON.stringify({ data: { klines: ["2026-07-01,10,11,12,9,100,1000,0,0,0,1"] } }));
  const newer = { data: { klines: ["2026-07-13,10,15,16,9,300,4000,0,0,0,3"] } };
  await fs.writeFile(yearlyFile, JSON.stringify(newer));

  const summary = await aggregateYearlyFromDaily({ codes: ["600001"], klineRoot: root, targetDate: "20260701" });
  assert.equal(summary.updated, 0);
  assert.equal(summary.items[0].reason, "newer_yearly_bar_exists");
  assert.deepEqual(JSON.parse(await fs.readFile(yearlyFile, "utf8")), newer);
});
