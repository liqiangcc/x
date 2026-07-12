"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  benchmarkReport,
  calculatePerformance,
  maximumDrawdown,
} = require("../src/simulator/application/reports");

test("performance calculates return, drawdown, volatility and trade statistics", () => {
  const snapshots = [
    { date: "2026-01-01", equity: 100000, realizedPnl: 0, unrealizedPnl: 0 },
    { date: "2026-01-02", equity: 110000, realizedPnl: 5000, unrealizedPnl: 5000 },
    { date: "2026-01-03", equity: 99000, realizedPnl: -1000, unrealizedPnl: 0 },
    { date: "2026-01-04", equity: 120000, realizedPnl: 15000, unrealizedPnl: 5000 },
  ];
  const performance = calculatePerformance({
    accountSnapshots: snapshots,
    fills: [
      { fees: { total: 5 }, grossAmount: 10000, realizedPnl: 1000, side: "sell", slippageAmount: 10 },
      { fees: { total: 6 }, grossAmount: 5000, realizedPnl: -500, side: "sell", slippageAmount: 5 },
    ],
    initialCash: 100000,
    orders: [{}, {}],
  });
  assert.equal(performance.totalReturn, 0.2);
  assert.ok(Math.abs(performance.maxDrawdown - 0.1) < 1e-12);
  assert.equal(performance.winRate, 0.5);
  assert.equal(performance.profitLossRatio, 2);
  assert.equal(performance.fees, 11);
  assert.equal(performance.slippage, 15);
  assert.equal(performance.orderCount, 2);
  assert.equal(Number.isFinite(performance.sharpe), true);
  assert.equal(Number.isFinite(performance.sortino), true);
});

test("short, no-trade and open-position sessions have stable output", () => {
  const performance = calculatePerformance({
    accountSnapshots: [{ date: "2026-07-01", equity: 101000, realizedPnl: 0, unrealizedPnl: 1000 }],
    initialCash: 100000,
  });
  assert.equal(performance.totalReturn, 0.01);
  assert.equal(performance.annualizedReturn, 0.01);
  assert.equal(performance.volatility, 0);
  assert.equal(performance.sharpe, 0);
  assert.equal(performance.winRate, null);
  assert.equal(performance.unrealizedPnl, 1000);
  assert.equal(maximumDrawdown([]), 0);
});

test("benchmark is optional but calculates return when a CSI300 series exists", () => {
  assert.deepEqual(benchmarkReport(), { status: "benchmark_unavailable" });
  assert.deepEqual(benchmarkReport([
    { close: 4000, date: "2026-07-01" },
    { close: 4200, date: "2026-07-31" },
  ]), {
    endDate: "2026-07-31",
    startDate: "2026-07-01",
    status: "available",
    totalReturn: 0.05,
  });
});
