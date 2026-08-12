"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildDrawdownBuyingPlan,
} = require("../src/business/simulation/drawdown_buying_policy");
const {
  simulateBuyOrders,
} = require("../src/simulation/portfolio/buy_only_portfolio_simulator");
const {
  SimulateDrawdownBuyingUseCase,
} = require("../src/application/simulation/simulate_drawdown_buying");

function bar(date, close) {
  return { date, open: close, close, high: close, low: close };
}

test("DrawdownBuyingPolicy emits initial entry and parameterized drawdown steps at exact boundaries", () => {
  const result = buildDrawdownBuyingPlan([
    bar("2026-01-02", 100),
    bar("2026-01-05", 95),
    bar("2026-01-06", 92),
    bar("2026-01-07", 84.64),
  ], {
    initialDrawdown: 0,
    drawdownStep: 0.08,
    trancheFraction: 0.25,
    maxPurchases: 4,
  });

  assert.deepEqual(result.signals.map((signal) => [signal.index, signal.type, signal.date, signal.price]), [
    [1, "initial_entry", "2026-01-02", 100],
    [2, "drawdown_step", "2026-01-06", 92],
    [3, "drawdown_step", "2026-01-07", 84.64],
  ]);
  assert.equal(result.signals[1].triggerPrice, 92);
  assert.equal(result.signals[1].drawdownFromReference, 0.08);
  assert.ok(Math.abs(result.signals[2].triggerPrice - 84.64) < 1e-12);
  assert.equal(result.summary.signalCount, 3);
  assert.equal(result.summary.requestedAllocationFraction, 0.75);
  assert.equal(result.summary.remainingAllocationFraction, 0.25);
});

test("DrawdownBuyingPolicy can delay the first entry until a configured peak drawdown", () => {
  const result = buildDrawdownBuyingPlan([
    bar("2026-01-02", 100),
    bar("2026-01-05", 110),
    bar("2026-01-06", 95),
    bar("2026-01-07", 88),
    bar("2026-01-08", 79.2),
  ], {
    initialDrawdown: 0.2,
    drawdownStep: 0.1,
    trancheFraction: 0.2,
    maxPurchases: 5,
  });

  assert.deepEqual(result.signals.map((signal) => signal.date), ["2026-01-07", "2026-01-08"]);
  assert.equal(result.signals[0].referenceDate, "2026-01-05");
  assert.equal(result.signals[0].referencePrice, 110);
  assert.equal(result.signals[0].triggerPrice, 88);
  assert.equal(result.signals[0].drawdownFromReference, 0.2);
  assert.ok(Math.abs(result.signals[1].triggerPrice - 79.2) < 1e-12);
});

test("DrawdownBuyingPolicy owns allocation rules instead of hard-coding one strategy", () => {
  const tenPercent = buildDrawdownBuyingPlan([
    bar("2026-01-02", 100),
    bar("2026-01-05", 91),
    bar("2026-01-06", 90),
  ], {
    drawdownStep: 0.1,
    trancheFraction: 0.5,
    maxPurchases: 2,
  });
  assert.deepEqual(tenPercent.signals.map((signal) => signal.date), ["2026-01-02", "2026-01-06"]);
  assert.throws(
    () => buildDrawdownBuyingPlan([bar("2026-01-02", 100)], { trancheFraction: 0.25, maxPurchases: 5 }),
    /must not exceed 1/
  );
});

test("buy-only portfolio capability executes budgets through shared Account and Position accounting", () => {
  const result = simulateBuyOrders({
    bars: [
      bar("2026-01-02", 10),
      bar("2026-01-05", 8),
      bar("2026-01-06", 12),
    ],
    orders: [
      { date: "2026-01-02", budget: 300, metadata: { source: "one" } },
      { date: "2026-01-05", budget: 300, metadata: { source: "two" } },
    ],
    security: { code: "600001", market: 1 },
    initialCash: 1000,
    lotSize: 10,
  });

  assert.deepEqual(result.trades.map((trade) => [trade.status, trade.quantity, trade.totalCost]), [
    ["filled", 30, 300],
    ["filled", 30, 240],
  ]);
  assert.equal(result.summary.investedAmount, 540);
  assert.equal(result.summary.remainingCash, 460);
  assert.equal(result.summary.quantity, 60);
  assert.equal(result.summary.averageCost, 9);
  assert.equal(result.summary.finalPrice, 12);
  assert.equal(result.summary.marketValue, 720);
  assert.equal(result.summary.equity, 1180);
  assert.equal(result.summary.unrealizedPnl, 180);
  assert.equal(result.summary.totalReturn, 0.18);
  assert.equal(result.config.feesIncluded, false);
  assert.equal(result.config.slippageIncluded, false);
});

test("buy-only portfolio capability reports too-small budgets without inventing fractional lots", () => {
  const result = simulateBuyOrders({
    bars: [bar("2026-01-02", 10)],
    orders: [{ date: "2026-01-02", budget: 50 }],
    security: { code: "600001", market: 1 },
    initialCash: 1000,
    lotSize: 10,
  });
  assert.equal(result.trades[0].status, "skipped_insufficient_budget");
  assert.equal(result.trades[0].quantity, 0);
  assert.equal(result.summary.equity, 1000);
  assert.equal(result.summary.quantity, 0);
});

test("SimulateDrawdownBuyingUseCase orchestrates KlineReader, policy, and portfolio capability without storage logic", async () => {
  const calls = [];
  const useCase = new SimulateDrawdownBuyingUseCase({
    klineReader: {
      async readRange(input) {
        calls.push(input);
        return {
          security: { code: "600001", market: 1 },
          period: "daily",
          startDate: "2026-01-02",
          endDate: "2026-01-06",
          bars: [
            bar("2026-01-02", 100),
            bar("2026-01-05", 92),
            bar("2026-01-06", 84.64),
          ],
          dataMode: "legacy_approximate",
          priceView: "legacy_forward_adjusted",
          qualityIssues: ["example_quality"],
          source: { kind: "fake_kline_reader" },
        };
      },
    },
  });

  const result = await useCase.execute({
    code: "600001",
    market: 1,
    startDate: "2026-01-02",
    endDate: "2026-01-06",
    initialCapital: 1000,
    drawdownStep: 0.08,
    trancheFraction: 0.25,
    maxPurchases: 4,
    lotSize: 1,
  });

  assert.deepEqual(calls, [{
    code: "600001",
    market: 1,
    startDate: "2026-01-02",
    endDate: "2026-01-06",
    period: "daily",
    limit: null,
  }]);
  assert.deepEqual(result.signals.map((signal) => signal.date), [
    "2026-01-02",
    "2026-01-05",
    "2026-01-06",
  ]);
  assert.deepEqual(result.trades.map((trade) => trade.requestedBudget), [250, 250, 250]);
  assert.equal(result.summary.policy.signalCount, 3);
  assert.equal(result.summary.portfolio.filledTradeCount, 3);
  assert.equal(result.summary.portfolio.quantity, 6);
  assert.equal(result.meta.source.kind, "fake_kline_reader");
  assert.deepEqual(result.meta.qualityIssues, ["example_quality"]);
  assert.equal(result.meta.execution.feesIncluded, false);
});

test("SimulateDrawdownBuyingUseCase keeps policy and portfolio implementations injectable", async () => {
  const calls = [];
  const useCase = new SimulateDrawdownBuyingUseCase({
    klineReader: { async readRange() { return { security: { code: "600001", market: 1 }, period: "daily", startDate: null, endDate: "2026-01-02", bars: [], qualityIssues: [], source: {} }; } },
    buildPlan(bars, config) {
      calls.push({ layer: "policy", bars, config });
      return { signals: [], summary: { signalCount: 0 }, config };
    },
    simulatePortfolio(input) {
      calls.push({ layer: "portfolio", input });
      return { trades: [], summary: { equity: input.initialCash }, config: { feesIncluded: false, slippageIncluded: false } };
    },
  });

  const result = await useCase.execute({ code: "600001", market: 1, endDate: "2026-01-02" });
  assert.equal(calls[0].layer, "policy");
  assert.equal(calls[1].layer, "portfolio");
  assert.deepEqual(calls[1].input.orders, []);
  assert.equal(result.summary.portfolio.equity, 100000);
});
