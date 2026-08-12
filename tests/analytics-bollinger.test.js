"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  calculateBollSeries,
  calculateBollWindow,
} = require("../src/signals/indicators/boll");
const {
  CalculateBollingerUseCase,
} = require("../src/application/analytics/calculate_bollinger");

function closeTo(actual, expected, epsilon = 1e-12) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} is not close to ${expected}`);
}

function bar(date, close) {
  return {
    date,
    open: close,
    close,
    high: close,
    low: close,
    volume: 1000,
    amount: 10000,
    changePct: 0,
  };
}

test("existing BOLL implementation remains the authoritative deterministic calculator", () => {
  const window = calculateBollWindow([1, 2, 3], { multiplier: 2, stddevMode: "population" });
  closeTo(window.middle, 2);
  closeTo(window.stddev, Math.sqrt(2 / 3));
  closeTo(window.lower, 2 - (2 * Math.sqrt(2 / 3)));
  closeTo(window.upper, 2 + (2 * Math.sqrt(2 / 3)));

  const series = calculateBollSeries([
    { date: "2026-01-01", close: 1 },
    { date: "2026-01-02", close: 2 },
    { date: "2026-01-03", close: 3 },
  ], { period: 3 });
  assert.equal(series[0].middle, null);
  assert.equal(series[1].middle, null);
  closeTo(series[2].middle, 2);
});

test("Bollinger use case reuses KlineReader and returns bounded latest points", async () => {
  const calls = [];
  const bars = [
    bar("2026-01-01", 10),
    bar("2026-01-02", 11),
    bar("2026-01-03", 12),
    bar("2026-01-04", 13),
    bar("2026-01-05", 14),
    bar("2026-01-06", 15),
  ];
  const klineReader = {
    async readRange(input) {
      calls.push(input);
      return {
        security: { code: "600001", market: 1 },
        period: "daily",
        startDate: null,
        endDate: "2026-01-06",
        bars: bars.slice(-input.limit),
        dataMode: "legacy_approximate",
        priceView: "legacy_forward_adjusted",
        qualityIssues: ["legacy_approximate"],
        source: { kind: "repo_ledger", contentHash: "hash", path: "fixture.json" },
      };
    },
  };
  const useCase = new CalculateBollingerUseCase({ klineReader });

  const result = await useCase.execute({
    code: "600001",
    market: 1,
    endDate: "2026-01-06",
    window: 3,
    multiplier: 2,
    stddevMode: "population",
    priceField: "close",
    points: 2,
  });

  assert.deepEqual(calls, [{
    code: "600001",
    market: 1,
    startDate: null,
    endDate: "2026-01-06",
    period: "daily",
    limit: 4,
  }]);
  assert.deepEqual(result.points.map((point) => point.date), ["2026-01-05", "2026-01-06"]);
  assert.deepEqual(result.points.map((point) => point.price), [14, 15]);
  closeTo(result.points[0].middle, 13);
  closeTo(result.points[1].middle, 14);
  assert.equal(result.latest.date, "2026-01-06");
  closeTo(result.latest.middle, 14);
  assert.deepEqual(result.coverage, {
    inputBars: 4,
    returnedPoints: 2,
    validPoints: 2,
    warmupComplete: true,
  });
  assert.equal(result.meta.source.kind, "repo_ledger");
});

test("Bollinger use case preserves explicit analysis range and never asks for future data", async () => {
  const calls = [];
  const useCase = new CalculateBollingerUseCase({
    klineReader: {
      async readRange(input) {
        calls.push(input);
        return {
          security: { code: "600001", market: 1 },
          period: "daily",
          startDate: "2026-01-02",
          endDate: "2026-01-04",
          bars: [bar("2026-01-02", 10), bar("2026-01-03", 11), bar("2026-01-04", 12)],
          dataMode: "test",
          priceView: "test",
          qualityIssues: [],
          source: { kind: "test", contentHash: null, path: null },
        };
      },
    },
  });

  const result = await useCase.execute({
    code: "600001",
    market: 1,
    startDate: "2026-01-02",
    endDate: "2026-01-04",
    window: 2,
    points: 10,
  });

  assert.deepEqual(calls, [{
    code: "600001",
    market: 1,
    startDate: "2026-01-02",
    endDate: "2026-01-04",
    period: "daily",
    limit: null,
  }]);
  assert.equal(result.points.at(-1).date, "2026-01-04");
  assert.equal(result.coverage.inputBars, 3);
});

test("Bollinger use case validates analysis parameters before storage access", async () => {
  let reads = 0;
  const useCase = new CalculateBollingerUseCase({
    klineReader: {
      async readRange() {
        reads += 1;
        return { bars: [] };
      },
    },
  });

  await assert.rejects(
    () => useCase.execute({ code: "600001", market: 1, endDate: "2026-01-01", window: 0 }),
    /window/
  );
  await assert.rejects(
    () => useCase.execute({ code: "600001", market: 1, endDate: "2026-01-01", stddevMode: "sample", window: 1 }),
    /at least 2/
  );
  await assert.rejects(
    () => useCase.execute({ code: "600001", market: 1, endDate: "2026-01-01", priceField: "volume" }),
    /priceField/
  );
  await assert.rejects(
    () => useCase.execute({ code: "600001", market: 1, endDate: "2026-01-01", points: 201 }),
    /points/
  );
  assert.equal(reads, 0);
  assert.throws(() => new CalculateBollingerUseCase(), /klineReader/);
});
