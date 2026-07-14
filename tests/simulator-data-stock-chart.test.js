"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { SimulatorRuntimeService } = require("../src/simulator/application/runtime_service");

function bar(date, close) {
  return { amount: 1000, close, date, high: close + 1, low: close - 1, open: close - 0.5, volume: 100 };
}

test("raw data stock chart exposes chart windows and full data ranges", async () => {
  const calls = [];
  const runtime = new SimulatorRuntimeService({
    identityDirectory: { lookup: (security) => ({ ...security, name: "示例股票" }) },
    klineRepository: {
      getLegacyHistory: async (input) => {
        calls.push(input);
        return input.period === "daily"
          ? { bars: [bar("2025-12-31", 10), bar("2026-01-02", 11)], qualityIssues: [] }
          : { bars: [bar("2025-12-31", 10)], qualityIssues: [] };
      },
    },
  });

  const result = await runtime.getDataStockChart("600001");

  assert.equal(result.alias, "示例股票");
  assert.equal(result.security.market, 1);
  assert.equal(result.daily.length, 2);
  assert.deepEqual(result.yearly.map((row) => row.year), [2025, 2026]);
  assert.deepEqual(result.range.daily, { count: 2, end: "2026-01-02", start: "2025-12-31" });
  assert.deepEqual(calls.map((call) => call.period).sort(), ["daily", "yearly"]);
});

test("raw data stock chart rejects invalid or unavailable codes", async () => {
  const runtime = new SimulatorRuntimeService({
    klineRepository: { getLegacyHistory: async () => ({ bars: [], qualityIssues: [] }) },
  });

  await assert.rejects(runtime.getDataStockChart("abc"), { code: "invalid_security_code", statusCode: 400 });
  await assert.rejects(runtime.getDataStockChart("000001"), { code: "stock_data_not_found", statusCode: 404 });
});

test("data status details and strategy codes include security names", async () => {
  const runtime = new SimulatorRuntimeService({
    dataStatusService: {
      get: async () => ({ periods: {}, strategyUniverse: { codes: ["600001"] } }),
      getDetails: async () => ({ items: [{ code: "000001", status: "ok" }] }),
    },
    identityDirectory: { lookup: (security) => ({ ...security, name: security.code === "600001" ? "沪市示例" : "深市示例" }) },
  });

  const status = await runtime.getDataStatus();
  const detail = await runtime.getDataStatusDetails({ period: "daily" });

  assert.deepEqual(status.strategyUniverse.securities, [{ code: "600001", market: 1, name: "沪市示例" }]);
  assert.deepEqual(detail.items, [{ code: "000001", name: "深市示例", status: "ok" }]);
});
