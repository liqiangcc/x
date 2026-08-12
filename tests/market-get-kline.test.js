"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  DEFAULT_KLINE_LIMIT,
  GetKlineRangeUseCase,
  LEDGER_DEFAULT_ADJUSTMENT,
  MAX_KLINE_LIMIT,
  normalizeAdjustment,
  normalizeKlineLimit,
  previousIsoDate,
  toKlineBar,
} = require("../src/application/market/get_kline_range");

function bar(date, close) {
  return {
    date,
    open: close - 1,
    close,
    high: close + 1,
    low: close - 2,
    volume: 1000,
    amount: 10000,
    changePct: 1.5,
  };
}

test("get kline range use case reuses KlineReader and returns a bounded backward page", async () => {
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
          bar("2026-01-02", 10),
          bar("2026-01-05", 11),
          bar("2026-01-06", 12),
        ],
        dataMode: "legacy_approximate",
        priceView: "legacy_forward_adjusted",
        qualityIssues: ["legacy_approximate"],
        source: { kind: "test", contentHash: "hash", path: "fixture.json" },
      };
    },
  };
  const useCase = new GetKlineRangeUseCase({ klineReader });

  const result = await useCase.execute({
    code: "600001",
    market: 1,
    startDate: "2026-01-01",
    endDate: "2026-01-06",
    period: "daily",
    limit: 2,
    adjustment: "ledger_default",
  });

  assert.deepEqual(calls, [{
    code: "600001",
    market: 1,
    startDate: "2026-01-01",
    endDate: "2026-01-06",
    period: "daily",
    limit: 3,
  }]);
  assert.deepEqual(result.bars.map((item) => item.date), ["2026-01-05", "2026-01-06"]);
  assert.deepEqual(result.page, {
    limit: 2,
    returnedBars: 2,
    hasMore: true,
    nextEndDate: "2026-01-04",
  });
  assert.equal(result.adjustment, "ledger_default");
  assert.equal(result.meta.priceView, "legacy_forward_adjusted");
  assert.equal(result.meta.source.kind, "test");
});

test("get kline range use case defaults to a safe bounded page without inventing data", async () => {
  const calls = [];
  const useCase = new GetKlineRangeUseCase({
    klineReader: {
      async readRange(input) {
        calls.push(input);
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

  assert.equal(calls[0].limit, DEFAULT_KLINE_LIMIT + 1);
  assert.equal(result.bars.length, 0);
  assert.deepEqual(result.page, {
    limit: DEFAULT_KLINE_LIMIT,
    returnedBars: 0,
    hasMore: false,
    nextEndDate: null,
  });
  assert.deepEqual(result.meta.qualityIssues, ["missing_daily_kline"]);
});

test("get kline range validates context bounds and explicit adjustment before storage access", async () => {
  let reads = 0;
  const useCase = new GetKlineRangeUseCase({
    klineReader: {
      async readRange() {
        reads += 1;
        return { bars: [] };
      },
    },
  });

  await assert.rejects(
    () => useCase.execute({ code: "600001", market: 1, endDate: "2026-08-12", limit: 0 }),
    /between 1 and 500/
  );
  await assert.rejects(
    () => useCase.execute({ code: "600001", market: 1, endDate: "2026-08-12", limit: MAX_KLINE_LIMIT + 1 }),
    /between 1 and 500/
  );
  await assert.rejects(
    () => useCase.execute({ code: "600001", market: 1, endDate: "2026-08-12", adjustment: "raw" }),
    /ledger_default/
  );
  assert.equal(reads, 0);
});

test("kline range helpers keep deterministic contracts", () => {
  assert.equal(normalizeKlineLimit(undefined), DEFAULT_KLINE_LIMIT);
  assert.equal(normalizeKlineLimit(1), 1);
  assert.throws(() => normalizeKlineLimit(501), /between 1 and 500/);
  assert.equal(normalizeAdjustment(), LEDGER_DEFAULT_ADJUSTMENT);
  assert.throws(() => normalizeAdjustment("forward"), /ledger_default/);
  assert.equal(previousIsoDate("2024-03-01"), "2024-02-29");
  assert.deepEqual(toKlineBar({ date: "2026-01-02", close: 10 }), {
    date: "2026-01-02",
    open: null,
    close: 10,
    high: null,
    low: null,
    volume: null,
    amount: null,
    changePct: null,
  });
  assert.throws(() => new GetKlineRangeUseCase(), /KlineReader/);
  assert.throws(
    () => new GetKlineRangeUseCase({ klineReader: { readRange() {} }, maxBars: 0 }),
    /maxBars/
  );
});
