"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  calculateRecoveryPeriods,
  recoveryPeriodsFromDrawdowns,
  summarizeRecoveryPeriods,
} = require("../src/analytics/recovery/recovery_period_calculator");
const { AnalyzeRecoveryPeriodsUseCase } = require("../src/application/analytics/analyze_recovery_periods");

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

test("recovery calculator derives recovery durations from authoritative drawdown segmentation", () => {
  const periods = calculateRecoveryPeriods(rows, { minDrawdown: 0.15 });
  assert.equal(periods.length, 2);
  assert.deepEqual(periods[0], {
    peakDate: "2026-01-02",
    peakPrice: 100,
    troughDate: "2026-01-06",
    troughPrice: 80,
    drawdown: -0.2,
    declineTradingDays: 2,
    recoveryDate: "2026-01-08",
    recoveryTradingDays: 2,
    underwaterTradingDays: 4,
    status: "recovered",
  });
  assert.equal(periods[1].status, "ongoing");
  assert.equal(periods[1].recoveryDate, null);
  assert.equal(periods[1].recoveryTradingDays, null);
  assert.equal(periods[1].underwaterTradingDays, null);
});

test("recovery period derivation does not own peak-trough scanning rules", () => {
  const periods = recoveryPeriodsFromDrawdowns([{
    peakDate: "2026-01-02",
    peakPrice: 100,
    troughDate: "2026-01-05",
    troughPrice: 75,
    drawdown: -0.25,
    peakToTroughTradingDays: 1,
    recoveryDate: "2026-01-07",
    recoveryTradingDays: 2,
    status: "recovered",
  }]);
  assert.equal(periods[0].declineTradingDays, 1);
  assert.equal(periods[0].recoveryTradingDays, 2);
  assert.equal(periods[0].underwaterTradingDays, 3);
  assert.throws(() => recoveryPeriodsFromDrawdowns({}), /array/);
});

test("recovery summary reports recovered and ongoing timing separately", () => {
  const summary = summarizeRecoveryPeriods(calculateRecoveryPeriods(rows, { minDrawdown: 0.15 }));
  assert.deepEqual(summary, {
    eventCount: 2,
    recoveredCount: 1,
    ongoingCount: 1,
    averageRecoveryTradingDays: 2,
    maxRecoveryTradingDays: 2,
    averageUnderwaterTradingDays: 4,
    maxUnderwaterTradingDays: 4,
  });
  assert.deepEqual(summarizeRecoveryPeriods([]), {
    eventCount: 0,
    recoveredCount: 0,
    ongoingCount: 0,
    averageRecoveryTradingDays: null,
    maxRecoveryTradingDays: null,
    averageUnderwaterTradingDays: null,
    maxUnderwaterTradingDays: null,
  });
});

test("analyze recovery periods use case orchestrates the shared KlineReader once", async () => {
  const calls = [];
  const useCase = new AnalyzeRecoveryPeriodsUseCase({
    klineReader: {
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
          source: { kind: "repo_ledger", contentHash: "hash", path: "fixture.json" },
        };
      },
    },
  });

  const result = await useCase.execute({
    code: "600001",
    market: 1,
    startDate: "2026-01-02",
    endDate: "2026-01-14",
    minDrawdown: 0.15,
    priceField: "close",
  });

  assert.deepEqual(calls, [{
    code: "600001",
    market: 1,
    startDate: "2026-01-02",
    endDate: "2026-01-14",
    period: "daily",
    limit: null,
  }]);
  assert.equal(result.periods.length, 2);
  assert.equal(result.summary.recoveredCount, 1);
  assert.equal(result.meta.source.kind, "repo_ledger");
});

test("analyze recovery periods requires the KlineReader port", () => {
  assert.throws(() => new AnalyzeRecoveryPeriodsUseCase(), /klineReader/);
});
