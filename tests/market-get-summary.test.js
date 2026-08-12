"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { GetMarketSummaryUseCase } = require("../src/application/market/get_market_summary");

function bar(date, close, high = close, low = close) {
  return {
    date,
    open: close,
    close,
    high,
    low,
    volume: 1000,
    amount: 10000,
    changePct: 0,
  };
}

test("get market summary use case reuses KlineReader and exposes compact deterministic metrics", async () => {
  const calls = [];
  const klineReader = {
    async readRange(input) {
      calls.push(input);
      return {
        security: { code: "600001", market: 1 },
        period: "daily",
        startDate: "2026-01-01",
        endDate: "2026-01-06",
        bars: [
          bar("2026-01-02", 100, 102, 98),
          bar("2026-01-05", 80, 101, 75),
          bar("2026-01-06", 110, 115, 79),
        ],
        dataMode: "legacy_approximate",
        priceView: "legacy_forward_adjusted",
        qualityIssues: ["legacy_approximate"],
        source: { kind: "test", contentHash: "hash", path: "fixture.json" },
      };
    },
  };
  const useCase = new GetMarketSummaryUseCase({ klineReader });

  const result = await useCase.execute({
    code: "600001",
    market: 1,
    startDate: "2026-01-01",
    endDate: "2026-01-06",
    period: "daily",
    adjustment: "ledger_default",
  });

  assert.deepEqual(calls, [{
    code: "600001",
    market: 1,
    startDate: "2026-01-01",
    endDate: "2026-01-06",
    period: "daily",
    limit: null,
  }]);
  assert.deepEqual(result.latest, { date: "2026-01-06", close: 110 });
  assert.equal(result.range.firstClose, 100);
  assert.equal(result.range.lastClose, 110);
  assert.equal(result.range.returnRate, 0.10000000000000009);
  assert.deepEqual(result.range.high, { date: "2026-01-06", price: 115 });
  assert.deepEqual(result.range.low, { date: "2026-01-05", price: 75 });
  assert.deepEqual(result.coverage, {
    requestedStartDate: "2026-01-01",
    requestedEndDate: "2026-01-06",
    observedStartDate: "2026-01-02",
    observedEndDate: "2026-01-06",
    barCount: 3,
  });
  assert.equal(result.adjustment, "ledger_default");
  assert.deepEqual(result.meta.qualityIssues, ["legacy_approximate"]);
  assert.equal(result.meta.source.kind, "test");
});

test("get market summary use case preserves missing ledger data as explicit empty coverage", async () => {
  const useCase = new GetMarketSummaryUseCase({
    klineReader: {
      async readRange() {
        return {
          security: { code: "600001", market: 1 },
          period: "daily",
          startDate: null,
          endDate: "2026-08-12",
          bars: [],
          dataMode: "legacy_approximate",
          priceView: "legacy_forward_adjusted",
          qualityIssues: ["missing_daily_kline"],
          source: { kind: "repo_ledger", contentHash: null, path: null },
        };
      },
    },
  });

  const result = await useCase.execute({ code: "600001", market: 1, endDate: "2026-08-12" });
  assert.equal(result.latest, null);
  assert.equal(result.range.returnRate, null);
  assert.deepEqual(result.coverage, {
    requestedStartDate: null,
    requestedEndDate: "2026-08-12",
    observedStartDate: null,
    observedEndDate: null,
    barCount: 0,
  });
  assert.deepEqual(result.meta.qualityIssues, ["missing_daily_kline"]);
});

test("get market summary validates adjustment before storage access and owns no MCP concerns", async () => {
  let reads = 0;
  const useCase = new GetMarketSummaryUseCase({
    klineReader: {
      async readRange() {
        reads += 1;
        return { bars: [] };
      },
    },
  });

  await assert.rejects(
    () => useCase.execute({ code: "600001", market: 1, endDate: "2026-08-12", adjustment: "raw" }),
    /ledger_default/
  );
  assert.equal(reads, 0);
  assert.throws(() => new GetMarketSummaryUseCase(), /KlineReader/);
  assert.throws(
    () => new GetMarketSummaryUseCase({ klineReader: { readRange() {} }, calculate: null }),
    /calculate/
  );
});
