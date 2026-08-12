"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildDrawdownBuyingPlan,
} = require("../src/business/simulation/drawdown_buying_policy");
const {
  createBuyExecutionModelResolver,
} = require("../src/simulation/execution/buy_execution_model_resolver");
const {
  createLegacyBuyExecutionModel,
} = require("../src/simulation/execution/legacy_buy_execution_model");
const {
  simulateBuyOrders,
} = require("../src/simulation/portfolio/buy_only_portfolio_simulator");
const {
  SimulateDrawdownBuyingUseCase,
} = require("../src/application/simulation/simulate_drawdown_buying");

function bar(date, close) {
  return { date, open: close, close, high: close, low: close, volume: 1000 };
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

test("buy-only portfolio executes signals through the injected execution model and shared Account accounting", () => {
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
    executionModel: createLegacyBuyExecutionModel({ executionConfig: { lotSize: 10 } }),
  });

  assert.deepEqual(result.trades.map((trade) => [trade.status, trade.signalDate, trade.executionDate, trade.quantity, trade.totalCost]), [
    ["filled", "2026-01-02", "2026-01-05", 30, 245],
    ["filled", "2026-01-05", "2026-01-06", 20, 245],
  ]);
  assert.equal(result.summary.investedAmount, 490);
  assert.equal(result.summary.grossAmount, 480);
  assert.equal(result.summary.totalFees, 10);
  assert.equal(result.summary.totalSlippage, 0);
  assert.equal(result.summary.remainingCash, 510);
  assert.equal(result.summary.quantity, 50);
  assert.equal(result.summary.averageCost, 9.8);
  assert.equal(result.summary.finalPrice, 12);
  assert.equal(result.summary.marketValue, 600);
  assert.equal(result.summary.equity, 1110);
  assert.ok(Math.abs(result.summary.unrealizedPnl - 110) < 1e-9);
  assert.equal(result.summary.totalReturn, 0.11);
  assert.equal(result.config.timing, "next_trading_day_open");
  assert.equal(result.config.executionPriceField, "open");
  assert.equal(result.config.lotSize, 10);
  assert.equal(result.config.feesIncluded, true);
  assert.equal(result.config.slippageIncluded, true);
  assert.equal(result.config.marketRestrictionsIncluded, true);
});

test("buy-only portfolio reports too-small budgets without inventing fractional lots", () => {
  const result = simulateBuyOrders({
    bars: [bar("2026-01-02", 10), bar("2026-01-05", 10)],
    orders: [{ date: "2026-01-02", budget: 50 }],
    security: { code: "600001", market: 1 },
    initialCash: 1000,
    executionModel: createLegacyBuyExecutionModel({ executionConfig: { lotSize: 10 } }),
  });
  assert.equal(result.trades[0].status, "skipped_insufficient_budget");
  assert.equal(result.trades[0].quantity, 0);
  assert.equal(result.summary.equity, 1000);
  assert.equal(result.summary.quantity, 0);
});

test("SimulateDrawdownBuyingUseCase orchestrates KlineReader, policy, execution resolver, and portfolio without storage logic", async () => {
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
    executionModelResolver: createBuyExecutionModelResolver(),
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
  assert.deepEqual(result.trades.map((trade) => trade.status), ["filled", "filled", "skipped_no_execution_bar"]);
  assert.equal(result.summary.policy.signalCount, 3);
  assert.equal(result.summary.portfolio.filledTradeCount, 2);
  assert.equal(result.summary.portfolio.skippedTradeCount, 1);
  assert.equal(result.summary.portfolio.quantity, 4);
  assert.equal(result.summary.portfolio.totalFees, 10);
  assert.equal(result.meta.source.kind, "fake_kline_reader");
  assert.deepEqual(result.meta.qualityIssues, ["example_quality"]);
  assert.equal(result.meta.execution.timing, "next_trading_day_open");
  assert.equal(result.meta.execution.feesIncluded, true);
  assert.equal(result.meta.execution.slippageIncluded, true);
});

test("SimulateDrawdownBuyingUseCase keeps policy, resolver, and portfolio implementations injectable", async () => {
  const calls = [];
  const fakeExecutionModel = {
    executeBuy() { throw new Error("fake portfolio owns execution in this test"); },
    describe() { return { kind: "fake", feesIncluded: true, slippageIncluded: true }; },
  };
  const useCase = new SimulateDrawdownBuyingUseCase({
    klineReader: { async readRange() { return { security: { code: "600001", market: 1 }, period: "daily", startDate: null, endDate: "2026-01-02", bars: [], qualityIssues: [], source: {} }; } },
    executionModelResolver: {
      resolve(input) {
        calls.push({ layer: "execution", input });
        return fakeExecutionModel;
      },
    },
    buildPlan(bars, config) {
      calls.push({ layer: "policy", bars, config });
      return { signals: [], summary: { signalCount: 0 }, config };
    },
    simulatePortfolio(input) {
      calls.push({ layer: "portfolio", input });
      return { trades: [], summary: { equity: input.initialCash }, config: { kind: "fake", feesIncluded: true, slippageIncluded: true } };
    },
  });

  const result = await useCase.execute({
    code: "600001",
    market: 1,
    endDate: "2026-01-02",
    executionModel: "frictionless",
  });
  assert.equal(calls[0].layer, "policy");
  assert.equal(calls[1].layer, "execution");
  assert.deepEqual(calls[1].input, {
    model: "frictionless",
    executionConfig: { lotSize: 100 },
  });
  assert.equal(calls[2].layer, "portfolio");
  assert.equal(calls[2].input.executionModel, fakeExecutionModel);
  assert.equal("lotSize" in calls[2].input, false);
  assert.deepEqual(calls[2].input.orders, []);
  assert.equal(result.config.executionModel, "frictionless");
  assert.equal(result.summary.portfolio.equity, 100000);
});

test("SimulateDrawdownBuyingUseCase rejects unknown execution models before reading market data", async () => {
  let readCount = 0;
  const useCase = new SimulateDrawdownBuyingUseCase({
    klineReader: {
      async readRange() {
        readCount += 1;
        throw new Error("must not read");
      },
    },
    executionModelResolver: createBuyExecutionModelResolver(),
  });

  await assert.rejects(
    () => useCase.execute({
      code: "600001",
      market: 1,
      endDate: "2026-01-02",
      executionModel: "unknown",
    }),
    /executionModel must be one of: legacy_a_share, domestic_stock_etf, frictionless/
  );
  assert.equal(readCount, 0);
});
