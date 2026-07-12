"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  ExistingKlineRepository,
} = require("../src/simulator/adapters/ledger/existing_kline_repository");

async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "x-simulator-kline-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, repository: new ExistingKlineRepository({ klineRoot: root }) };
}

async function write(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const source = `${JSON.stringify(payload, null, 2)}\n`;
  await fs.writeFile(filePath, source, "utf8");
  return { source, hash: crypto.createHash("sha256").update(source).digest("hex") };
}

const rows = [
  "2026-06-30,10.00,10.20,10.30,9.90,1000,10100",
  "2026-07-01,10.20,10.40,10.50,10.10,1200,12400",
  "2026-07-02,10.50,10.60,10.70,10.40,1300,13700",
];

test("existing kline reads sharded files and truncates future rows", async (t) => {
  const { root, repository } = await setup(t);
  const filePath = path.join(root, "daily", "600", "600001.json");
  const written = await write(filePath, { code: "600001", klines: rows });
  const result = await repository.getLegacyHistory({
    code: "600001",
    market: 1,
    endDate: "2026-07-01",
    period: "daily",
  });
  assert.deepEqual(result.bars.map((bar) => bar.date), ["2026-06-30", "2026-07-01"]);
  assert.equal(result.contentHash, written.hash);
  assert.equal(result.sourcePath, filePath);
  assert.equal(result.dataMode, "legacy_approximate");
  assert.equal(result.priceView, "legacy_forward_adjusted");
});

test("existing kline falls back to legacy paths and applies limit", async (t) => {
  const { root, repository } = await setup(t);
  await write(path.join(root, "yearly", "600001.json"), { data: { klines: rows } });
  const result = await repository.getLegacyHistory({
    code: "600001",
    market: 1,
    endDate: "20260702",
    period: "yearly",
    limit: 2,
  });
  assert.deepEqual(result.bars.map((bar) => bar.date), ["2026-07-01", "2026-07-02"]);
  assert.match(result.sourcePath, /yearly\/600001\.json$/);
});

test("existing kline returns explicit missing quality issues", async (t) => {
  const { repository } = await setup(t);
  const history = await repository.getLegacyHistory({
    code: "600001",
    market: 1,
    endDate: "20260701",
    period: "daily",
  });
  assert.deepEqual(history.bars, []);
  assert.deepEqual(history.qualityIssues, ["missing_daily_kline"]);

  const bar = await repository.getLegacyBar({ code: "600001", market: 1, date: "20260701" });
  assert.equal(bar.executionEligible, false);
  assert.deepEqual(bar.qualityIssues, ["missing_daily_kline", "missing_execution_bar"]);
});

test("existing kline rejects non-positive execution prices", async (t) => {
  const { root, repository } = await setup(t);
  await write(path.join(root, "daily", "600", "600001.json"), {
    klines: ["2026-07-01,-1.00,-1.00,-0.90,-1.10,1000,1000"],
  });
  const result = await repository.getLegacyBar({ code: "600001", market: 1, date: "20260701" });
  assert.equal(result.executionEligible, false);
  assert.deepEqual(result.qualityIssues, ["invalid_execution_price"]);
});

test("existing kline reports malformed rows without leaking future data", async (t) => {
  const { root, repository } = await setup(t);
  await write(path.join(root, "daily", "600", "600001.json"), {
    klines: [rows[0], "not-a-kline", rows[2]],
  });
  const result = await repository.getLegacyHistory({
    code: "600001",
    market: 1,
    endDate: "20260701",
    period: "daily",
  });
  assert.deepEqual(result.bars.map((bar) => bar.date), ["2026-06-30"]);
  assert.deepEqual(result.qualityIssues, ["invalid_kline"]);
});

test("existing kline validates input and invalid JSON", async (t) => {
  const { root, repository } = await setup(t);
  await assert.rejects(
    () => repository.getLegacyHistory({ code: "600001", market: 1, endDate: "bad" }),
    /endDate/
  );
  const filePath = path.join(root, "daily", "600", "600001.json");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, "{", "utf8");
  await assert.rejects(
    () => repository.getLegacyBar({ code: "600001", market: 1, date: "20260701" }),
    (error) => error.code === "invalid_kline_file"
  );
});
