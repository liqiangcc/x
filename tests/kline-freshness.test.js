"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { inferExpectedDate, inspectFreshness, normalizeDate, writeRepairCodes } = require("../src/kline/freshness");

async function writeKline(root, period, code, klines) {
  const file = path.join(root, period, code.slice(0, 3), `${code}.json`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify({ code, period, klines })}\n`, "utf8");
}

test("inferExpectedDate uses the mode with newest-date tie breaking", () => {
  assert.equal(inferExpectedDate({ "2026-07-09": 2, "2026-07-10": 2, "2026-07-08": 1 }), "2026-07-10");
});

test("normalizeDate rejects impossible calendar dates", () => {
  assert.throws(() => normalizeDate("20260230"), /Invalid expected latest date/);
});

test("freshness classifies fresh stale missing invalid and extra files", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "x-kline-freshness-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const codesFile = path.join(root, "codes.json");
  await fs.writeFile(codesFile, JSON.stringify({ codes: ["000001", "000002", "000003", "000004"] }));
  await writeKline(root, "daily", "000001", ["2026-07-10,1,1,1,1,1,1,0,0,0,0"]);
  await writeKline(root, "daily", "000002", ["2026-07-09,1,1,1,1,1,1,0,0,0,0"]);
  await writeKline(root, "daily", "000003", []);
  await writeKline(root, "daily", "999999", ["2026-07-10,1,1,1,1,1,1,0,0,0,0"]);

  const report = await inspectFreshness({
    codesFile,
    expectedLatestDate: "20260710",
    period: "daily",
    targetRoot: root,
  });
  assert.equal(report.fresh_count, 1);
  assert.equal(report.stale_count, 1);
  assert.equal(report.invalid_count, 1);
  assert.equal(report.missing_count, 1);
  assert.equal(report.extra_count, 1);
  assert.deepEqual(report.repair_codes, ["000002", "000003", "000004"]);
});

test("repair output is directly compatible with sync code files", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "x-kline-repair-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const output = path.join(root, "repair.json");
  await writeRepairCodes(output, {
    expected_latest_date: "2026-07-10",
    period: "yearly",
    repair_codes: ["000001", "600519"],
  });
  assert.deepEqual(JSON.parse(await fs.readFile(output, "utf8")), {
    period: "yearly",
    expected_latest_date: "2026-07-10",
    total_codes: 2,
    codes: ["000001", "600519"],
  });
});
