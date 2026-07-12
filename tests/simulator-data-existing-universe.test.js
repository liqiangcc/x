"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  ExistingUniverseRepository,
  normalizeCodes,
} = require("../src/simulator/adapters/ledger/existing_universe");

async function writeJson(filePath, value = {}) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value), "utf8");
}

async function withRepository(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "x-simulator-universe-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return {
    root,
    repository: new ExistingUniverseRepository({
      universeRoot: path.join(root, "universe"),
      poolRoot: path.join(root, "pool"),
      klineRoot: path.join(root, "kline"),
    }),
  };
}

test("normalizeCodes accepts supported codes and reports stable security ordering", () => {
  assert.deepEqual(normalizeCodes(["600519", "000001", "920001", "invalid", "600519"]), [
    { code: "000001", market: 0 },
    { code: "920001", market: 0 },
    { code: "600519", market: 1 },
  ]);
});

test("existing universe prefers the market snapshot", async (t) => {
  const { root, repository } = await withRepository(t);
  await writeJson(path.join(root, "universe", "20260701", "codes.json"), {
    codes: ["600519", "000001", "bad"],
  });
  await writeJson(path.join(root, "pool", "20260701", "codes.json"), {
    codes: ["600000"],
  });

  const result = await repository.listAvailableCodes({ asOfDate: "2026-07-01" });
  assert.equal(result.source, "market_universe_snapshot");
  assert.deepEqual(result.securities, [
    { code: "000001", market: 0 },
    { code: "600519", market: 1 },
  ]);
  assert.deepEqual(result.coverage, { rawCount: 3, validCount: 2, excludedCount: 1 });
  assert.equal(result.qualityIssues.includes("survivorship_bias_possible"), true);
});

test("existing universe falls back to the pool snapshot", async (t) => {
  const { root, repository } = await withRepository(t);
  await writeJson(path.join(root, "pool", "20260701", "codes.json"), {
    codes: ["600003", "000002"],
  });

  const result = await repository.listAvailableCodes({ asOfDate: "20260701" });
  assert.equal(result.source, "pool_codes_snapshot");
  assert.equal(result.securities.length, 2);
  assert.equal(result.qualityIssues.includes("pool_limited_universe"), true);
});

test("existing universe falls back to the daily and yearly file intersection", async (t) => {
  const { root, repository } = await withRepository(t);
  await writeJson(path.join(root, "kline", "daily", "600", "600001.json"));
  await writeJson(path.join(root, "kline", "daily", "000002.json"));
  await writeJson(path.join(root, "kline", "daily", "300", "300001.json"));
  await writeJson(path.join(root, "kline", "yearly", "600", "600001.json"));
  await writeJson(path.join(root, "kline", "yearly", "000", "000002.json"));

  const result = await repository.listAvailableCodes({ asOfDate: "20260701" });
  assert.equal(result.source, "existing_kline_universe");
  assert.deepEqual(result.securities, [
    { code: "000002", market: 0 },
    { code: "600001", market: 1 },
  ]);
  assert.equal(result.qualityIssues.includes("kline_derived_universe"), true);
});

test("existing universe returns an empty derived result instead of throwing", async (t) => {
  const { repository } = await withRepository(t);
  const result = await repository.listAvailableCodes({ asOfDate: "20260701" });
  assert.equal(result.source, "existing_kline_universe");
  assert.deepEqual(result.securities, []);
  assert.deepEqual(result.coverage, { rawCount: 0, validCount: 0, excludedCount: 0 });
});

test("existing universe rejects malformed dates and JSON", async (t) => {
  const { root, repository } = await withRepository(t);
  await assert.rejects(() => repository.listAvailableCodes({ asOfDate: "2026-99" }), /asOfDate/);
  const filePath = path.join(root, "universe", "20260701", "codes.json");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, "{", "utf8");
  await assert.rejects(
    () => repository.listAvailableCodes({ asOfDate: "20260701" }),
    (error) => error.code === "invalid_universe_file"
  );
});
