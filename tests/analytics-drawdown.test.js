"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  calculateDrawdowns,
  summarizeDrawdowns,
} = require("../src/analytics/drawdown/drawdown_calculator");
const { AnalyzeDrawdownsUseCase } = require("../src/application/analytics/analyze_drawdowns");

function closeTo(actual, expected, epsilon = 1e-12) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} is not close to ${expected}`);
}

const rows = [
  { date: "2026-01-02", close: 100 },
  { date: "2026-01-05", close: 90 },
  { date: "2026-01-06", close: 80 },
  { date: "2026-01-07", close: 95 },
  { date: "2026-01-08", close: 100 },
  { date: "2026-01-09", close: 110 },
  { date: "2026-01-12", close: 99 },
  { date: "2026-01-13", close: 88 },
  { date: "2026-01-14", close: 90 },
];

test("drawdown calculator emits recovered and ongoing peak-to-trough events", () => {
  const events = calculateDrawdowns(rows, { minDrawdown: 0.15 });
  assert.equal(events.length, 2);

  assert.deepEqual({
    peakDate: events[0].peakDate,
    peakPrice: events[0].peakPrice,
    troughDate: events[0].troughDate,
    troughPrice: events[0].troughPrice,
    peakToTroughTradingDays: events[0].peakToTroughTradingDays,
    recoveryDate: events[0].recoveryDate,
    recoveryTradingDays: events[0].recoveryTradingDays,
    status: events[0].status,
  }, {
    peakDate: "2026-01-02",
    peakPrice: 100,
    troughDate: "2026-01-06",
    troughPrice: 80,
    peakToTroughTradingDays: 2,
    recoveryDate: "2026-01-08",
    recoveryTradingDays: 2,
    status: "recovered",
  });
  closeTo(events[0].drawdown, -0.20);

  assert.equal(events[1].peakDate, "2026-01-09");
  assert.equal(events[1].troughDate, "2026-01-13");
  assert.equal(events[1].recoveryDate, null);
  assert.equal(events[1].recoveryTradingDays, null);
  assert.equal(events[1].status, "ongoing");
  closeTo(events[1].drawdown, -0.20);
});

test("drawdown calculator applies minimum threshold without changing event segmentation", () => {
  assert.equal(calculateDrawdowns(rows, { minDrawdown: 0.20 }).length, 2);
  assert.deepEqual(calculateDrawdowns(rows, { minDrawdown: 0.21 }), []);
});

test("drawdown calculator supports another numeric price field", () => {
  const events = calculateDrawdowns([
    { date: "2026-01-02", high: 20 },
    { date: "2026-01-05", high: 15 },
  ], { priceField: "high", minDrawdown: 0.2 });
  assert.equal(events.length, 1);
  closeTo(events[0].drawdown, -0.25);
});

test("drawdown calculator validates deterministic input contract", () => {
  assert.throws(
    () => calculateDrawdowns([{ date: "2026-01-02", close: 10 }, { date: "2026-01-02", close: 9 }]),
    /strictly ordered/
  );
  assert.throws(
    () => calculateDrawdowns([{ date: "2026-01-02", close: 0 }]),
    /positive finite/
  );
  assert.throws(() => calculateDrawdowns(rows, { minDrawdown: 1 }), /minDrawdown/);
});

test("drawdown summary remains a pure derivation of events", () => {
  const events = calculateDrawdowns(rows, { minDrawdown: 0.15 });
  const summary = summarizeDrawdowns(events);
  assert.deepEqual({
    eventCount: summary.eventCount,
    ongoingCount: summary.ongoingCount,
    recoveredCount: summary.recoveredCount,
  }, {
    eventCount: 2,
    ongoingCount: 1,
    recoveredCount: 1,
  });
  closeTo(summary.maxDrawdown, -0.20);
  assert.deepEqual(summarizeDrawdowns([]), {
    eventCount: 0,
    maxDrawdown: null,
    ongoingCount: 0,
    recoveredCount: 0,
  });
});

test("analyze drawdowns use case orchestrates KlineReader and pure logic", async () => {
  const calls = [];
  const klineReader = {
    async readRange(input) {
      calls.push(input);
      return {
        security: { code: "600001", market: 1 },
        period: "daily",
        startDate: "2026-01-02",
        endDate: "2026-01-14",
        bars: rows,
        dataMode: "legacy_approximate",
        priceView: "legacy_forward_adjusted",
        qualityIssues: ["legacy_approximate"],
        source: { kind: "repo_ledger", contentHash: "hash", path: "data/kline/daily/600/600001.json" },
      };
    },
  };
  const useCase = new AnalyzeDrawdownsUseCase({ klineReader });
  const result = await useCase.execute({
    code: "600001",
    market: 1,
    startDate: "2026-01-02",
    endDate: "2026-01-14",
    minDrawdown: 0.15,
  });

  assert.deepEqual(calls, [{
    code: "600001",
    market: 1,
    startDate: "2026-01-02",
    endDate: "2026-01-14",
    period: "daily",
    limit: null,
  }]);
  assert.equal(result.events.length, 2);
  assert.equal(result.summary.eventCount, 2);
  assert.equal(result.summary.ongoingCount, 1);
  assert.deepEqual(result.meta, {
    dataMode: "legacy_approximate",
    priceView: "legacy_forward_adjusted",
    qualityIssues: ["legacy_approximate"],
    source: { kind: "repo_ledger", contentHash: "hash", path: "data/kline/daily/600/600001.json" },
  });
});

test("analyze drawdowns use case rejects a missing KlineReader port", () => {
  assert.throws(() => new AnalyzeDrawdownsUseCase(), /klineReader/);
});
