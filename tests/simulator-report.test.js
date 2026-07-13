"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  benchmarkReport,
  calculatePerformance,
  maximumDrawdown,
  stockCycleReviews,
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

test("stock review records closed and open holding cycles with return, days and BOLL", async () => {
  const security = { code: "600001", market: 1 };
  const orders = new Map([
    ["b1", { candidateId: "cand_a", id: "b1", security }],
    ["s1", { candidateId: "cand_a", id: "s1", security }],
    ["b2", { candidateId: "cand_a", id: "b2", security }],
  ]);
  const entry = {
    aliases: { publicForSecurity: () => ({ alias: "候选A", candidateId: "cand_a" }) },
    engine: { fills: [
      { cashAmount: 1005, date: "2026-07-01", fees: { total: 5 }, orderId: "b1", quantity: 100, side: "buy" },
      { cashAmount: 1094.5, date: "2026-07-02", fees: { total: 5.5 }, orderId: "s1", quantity: 100, side: "sell" },
      { cashAmount: 1205, date: "2026-07-03", fees: { total: 5 }, orderId: "b2", quantity: 100, side: "buy" },
    ] },
    orderService: { orders },
    session: { clock: { currentDate: "2026-07-06", dates: ["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-06"] } },
  };
  const cycles = await stockCycleReviews(entry, async (_security, date) => ({ aboveMiddle: date === "2026-07-06", bollMiddle: 11.5, close: 13 }));
  assert.equal(cycles.length, 2);
  assert.deepEqual(cycles.map((cycle) => [cycle.status, cycle.holdingDays, cycle.buyCount]), [["closed", 2, 1], ["open", 2, 1]]);
  assert.ok(Math.abs(cycles[0].returnPct - ((89.5 / 1005) * 100)) < 1e-10);
  assert.ok(Math.abs(cycles[1].returnPct - ((95 / 1205) * 100)) < 1e-10);
  assert.equal(cycles[0].totalPnl, 89.5);
  assert.equal(cycles[1].totalPnl, 95);
  assert.equal(cycles[1].bollAboveMiddle, true);
});
