"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const {
  BUY_EXECUTION_MODEL_PROVIDER_METHODS,
  assertBuyExecutionModelProvider,
} = require("../src/ports/simulation/buy_execution_model_provider");
const {
  TimelineBuyExecutionModelProvider,
} = require("../src/simulation/execution/timeline_buy_execution_model_provider");
const {
  simulateBuyOrders,
} = require("../src/simulation/portfolio/buy_only_portfolio_simulator");

function skippedExecution(signalDate) {
  return Object.freeze({
    status: "skipped_test",
    reason: "test",
    signalDate,
    executionDate: null,
    date: signalDate,
    requestedBudget: 1000,
    effectiveBudget: 1000,
    price: null,
    quantity: 0,
    grossAmount: 0,
    feeAmount: 0,
    fees: Object.freeze({ commission: 0, stampDuty: 0, total: 0 }),
    slippageAmount: 0,
    totalCost: 0,
    availableDate: null,
  });
}

function fakeModel(model) {
  return Object.freeze({
    describe() {
      return Object.freeze({ kind: "fake", profileId: model });
    },
    executeBuy({ signalDate }) {
      return skippedExecution(signalDate);
    },
  });
}

test("BuyExecutionModelProvider owns buy-context model selection rather than accepting a caller-selected date", () => {
  assert.deepEqual(BUY_EXECUTION_MODEL_PROVIDER_METHODS, ["resolveForBuy"]);
  const provider = { resolveForBuy() { return fakeModel("test"); } };
  assert.equal(assertBuyExecutionModelProvider(provider), provider);
  assert.throws(
    () => assertBuyExecutionModelProvider({ resolveForDate() { return fakeModel("old"); } }),
    /resolveForBuy/
  );
});

test("date-aware execution resolves the profile effective on the candidate execution date", () => {
  const resolvedModels = [];
  const executionModelResolver = {
    resolve({ model }) {
      resolvedModels.push(model);
      return fakeModel(model);
    },
  };
  const executionModelProvider = new TimelineBuyExecutionModelProvider({
    segments: [
      {
        startDate: "2026-01-02",
        endDate: "2026-01-04",
        profileId: "domestic_stock_etf",
      },
      {
        startDate: "2026-01-05",
        endDate: "2026-01-06",
        profileId: "t0_etf",
      },
    ],
    executionModelResolver,
  });

  const result = simulateBuyOrders({
    bars: [
      { date: "2026-01-02", open: 10, close: 10 },
      { date: "2026-01-05", open: 9, close: 9 },
      { date: "2026-01-06", open: 8, close: 8 },
    ],
    orders: [
      { date: "2026-01-02", budget: 1000 },
    ],
    security: { code: "513500", market: 1 },
    initialCash: 10000,
    priceField: "close",
    executionModelProvider,
  });

  assert.deepEqual(resolvedModels, ["t0_etf"]);
  assert.deepEqual(
    result.config.executionModels.map((model) => model.profileId),
    ["t0_etf"]
  );
});

test("date-aware execution falls back to the signal-date segment only when no execution bar exists", () => {
  const resolvedModels = [];
  const executionModelProvider = new TimelineBuyExecutionModelProvider({
    segments: [
      {
        startDate: "2026-01-02",
        endDate: "2026-01-02",
        profileId: "domestic_stock_etf",
      },
    ],
    executionModelResolver: {
      resolve({ model }) {
        resolvedModels.push(model);
        return fakeModel(model);
      },
    },
  });

  simulateBuyOrders({
    bars: [{ date: "2026-01-02", open: 10, close: 10 }],
    orders: [{ date: "2026-01-02", budget: 1000 }],
    security: { code: "513500", market: 1 },
    initialCash: 10000,
    priceField: "close",
    executionModelProvider,
  });

  assert.deepEqual(resolvedModels, ["domestic_stock_etf"]);
});

test("date-aware execution fails closed when the actual execution date is outside timeline coverage", () => {
  const executionModelProvider = new TimelineBuyExecutionModelProvider({
    segments: [
      {
        startDate: "2026-01-02",
        endDate: "2026-01-02",
        profileId: "domestic_stock_etf",
      },
    ],
    executionModelResolver: {
      resolve({ model }) {
        return fakeModel(model);
      },
    },
  });

  assert.throws(
    () => simulateBuyOrders({
      bars: [
        { date: "2026-01-02", open: 10, close: 10 },
        { date: "2026-01-05", open: 9, close: 9 },
      ],
      orders: [{ date: "2026-01-02", budget: 1000 }],
      security: { code: "513500", market: 1 },
      initialCash: 10000,
      priceField: "close",
      executionModelProvider,
    }),
    /execution profile timeline does not cover 2026-01-05/
  );
});

test("portfolio delegates temporal selection without owning execution timing logic", () => {
  const portfolioSource = fs.readFileSync(
    require.resolve("../src/simulation/portfolio/buy_only_portfolio_simulator"),
    "utf8"
  );
  assert.match(portfolioSource, /resolveForBuy/);
  assert.doesNotMatch(
    portfolioSource,
    /execution_model_support|resolveNextExecutionBar|resolveProviderDate|next_trading_day_open/
  );
});
