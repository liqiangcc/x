"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  assertBuyExecutionModel,
} = require("../src/ports/simulation/buy_execution_model");
const {
  createBuyExecutionModelResolver,
} = require("../src/simulation/execution/buy_execution_model_resolver");
const {
  createFrictionlessBuyExecutionModel,
} = require("../src/simulation/execution/frictionless_buy_execution_model");
const {
  SimulateDrawdownBuyingUseCase,
} = require("../src/application/simulation/simulate_drawdown_buying");

function bar(date, open, close = open, overrides = {}) {
  return {
    date,
    open,
    close,
    high: open * 1.05,
    low: open * 0.95,
    volume: 1000,
    ...overrides,
  };
}

function readerFor(bars) {
  return {
    async readRange() {
      return {
        security: { code: "600001", market: 1 },
        period: "daily",
        startDate: bars[0]?.date ?? null,
        endDate: bars.at(-1)?.date ?? null,
        bars,
        dataMode: "test",
        priceView: "raw",
        qualityIssues: [],
        source: { kind: "test" },
      };
    },
  };
}

test("frictionless buy execution model satisfies the shared port and executes next-day open without trading frictions", () => {
  const model = createFrictionlessBuyExecutionModel({ executionConfig: { lotSize: 100 } });
  assert.equal(assertBuyExecutionModel(model), model);

  const result = model.executeBuy({
    bars: [
      bar("2026-01-02", 10),
      bar("2026-01-05", 9, 9, { limitUp: true, limitUpPrice: 9, volume: 0 }),
    ],
    signalDate: "2026-01-02",
    requestedBudget: 5000,
    cashAvailable: 5000,
  });

  assert.equal(result.status, "filled");
  assert.equal(result.executionDate, "2026-01-05");
  assert.equal(result.price, 9);
  assert.equal(result.quantity, 500);
  assert.equal(result.grossAmount, 4500);
  assert.equal(result.feeAmount, 0);
  assert.equal(result.slippageAmount, 0);
  assert.equal(result.totalCost, 4500);
  assert.equal(result.availableDate, "2026-01-05");

  const description = model.describe();
  assert.equal(description.kind, "frictionless_next_open");
  assert.equal(description.timing, "next_trading_day_open");
  assert.equal(description.executionPriceField, "open");
  assert.equal(description.lotSize, 100);
  assert.equal(description.feesIncluded, false);
  assert.equal(description.slippageIncluded, false);
  assert.equal(description.marketRestrictionsIncluded, false);
});

test("frictionless execution preserves lot sizing and does not fabricate a next bar", () => {
  const model = createFrictionlessBuyExecutionModel({ executionConfig: { lotSize: 100 } });

  const tooSmall = model.executeBuy({
    bars: [bar("2026-01-02", 10), bar("2026-01-05", 10)],
    signalDate: "2026-01-02",
    requestedBudget: 999,
    cashAvailable: 999,
  });
  assert.equal(tooSmall.status, "skipped_insufficient_budget");
  assert.equal(tooSmall.reason, "budget_cannot_cover_one_lot");

  const noNextBar = model.executeBuy({
    bars: [bar("2026-01-02", 10)],
    signalDate: "2026-01-02",
    requestedBudget: 5000,
    cashAvailable: 5000,
  });
  assert.equal(noNextBar.status, "skipped_no_execution_bar");
  assert.equal(noNextBar.reason, "no_next_trading_bar");
});

test("one use case and resolver compare frictionless and legacy execution without changing business rules", async () => {
  const bars = [
    bar("2026-01-02", 10, 10),
    bar("2026-01-05", 9, 9),
    bar("2026-01-06", 10, 10),
  ];
  const input = {
    code: "600001",
    market: 1,
    startDate: "2026-01-02",
    endDate: "2026-01-06",
    initialCapital: 10000,
    initialDrawdown: 0,
    drawdownStep: 0.08,
    trancheFraction: 0.5,
    maxPurchases: 1,
    lotSize: 100,
    priceField: "close",
  };
  const useCase = new SimulateDrawdownBuyingUseCase({
    klineReader: readerFor(bars),
    executionModelResolver: createBuyExecutionModelResolver(),
  });

  const frictionless = await useCase.execute({ ...input, executionModel: "frictionless" });
  const legacy = await useCase.execute({ ...input, executionModel: "legacy_a_share" });

  assert.deepEqual(frictionless.signals, legacy.signals);
  assert.equal(frictionless.config.executionModel, "frictionless");
  assert.equal(legacy.config.executionModel, "legacy_a_share");
  assert.equal(frictionless.meta.execution.kind, "frictionless_next_open");
  assert.equal(legacy.meta.execution.kind, "legacy_a_share_next_open");
  assert.equal(frictionless.summary.portfolio.quantity, legacy.summary.portfolio.quantity);
  assert.equal(frictionless.summary.portfolio.totalFees, 0);
  assert.equal(frictionless.summary.portfolio.totalSlippage, 0);
  assert.ok(legacy.summary.portfolio.totalFees > 0);
  assert.ok(legacy.summary.portfolio.totalSlippage > 0);
  assert.ok(frictionless.summary.portfolio.equity > legacy.summary.portfolio.equity);
  assert.ok(frictionless.summary.portfolio.totalReturn > legacy.summary.portfolio.totalReturn);
});
