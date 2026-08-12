"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  BUY_EXECUTION_MODEL_METHODS,
  assertBuyExecutionModel,
} = require("../src/ports/simulation/buy_execution_model");
const {
  createLegacyBuyExecutionModel,
} = require("../src/simulation/execution/legacy_buy_execution_model");
const {
  simulateBuyOrders,
} = require("../src/simulation/portfolio/buy_only_portfolio_simulator");
const {
  SimulateDrawdownBuyingUseCase,
} = require("../src/application/simulation/simulate_drawdown_buying");

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

function fakeKlineReader() {
  return {
    async readRange() {
      return {
        security: { code: "600001", market: 1 },
        period: "daily",
        startDate: null,
        endDate: "2026-01-02",
        bars: [],
        qualityIssues: [],
        source: { kind: "test" },
      };
    },
  };
}

test("BuyExecutionModel port accepts interchangeable implementations and rejects incomplete ones", () => {
  assert.deepEqual(BUY_EXECUTION_MODEL_METHODS, ["executeBuy", "describe"]);

  const fake = {
    executeBuy() { return { status: "skipped" }; },
    describe() { return { kind: "fake" }; },
  };
  assert.equal(assertBuyExecutionModel(fake), fake);

  const legacy = createLegacyBuyExecutionModel();
  assert.equal(assertBuyExecutionModel(legacy), legacy);

  assert.throws(() => assertBuyExecutionModel(null), /must be an object/);
  assert.throws(
    () => assertBuyExecutionModel({ executeBuy() {} }),
    /missing methods: describe/
  );
  assert.throws(
    () => assertBuyExecutionModel({ describe() {} }),
    /missing methods: executeBuy/
  );
});

test("portfolio requires an execution model instead of constructing a concrete implementation", () => {
  assert.throws(
    () => simulateBuyOrders({
      bars: [],
      orders: [],
      security: { code: "600001", market: 1 },
      initialCash: 1000,
    }),
    /buyExecutionModel implementation must be an object/
  );
});

test("simulation use case requires an injected execution model factory", () => {
  assert.throws(
    () => new SimulateDrawdownBuyingUseCase({ klineReader: fakeKlineReader() }),
    /createExecutionModel must be a function/
  );
});

test("concrete execution wiring is confined to the composition boundary", () => {
  const concreteModule = "legacy_buy_execution_model";
  const portfolioSource = source("src/simulation/portfolio/buy_only_portfolio_simulator.js");
  const applicationSource = source("src/application/simulation/simulate_drawdown_buying.js");
  const compositionSource = source("src/adapters/mcp/composition_root.js");

  assert.equal(portfolioSource.includes(concreteModule), false);
  assert.equal(applicationSource.includes(concreteModule), false);
  assert.equal(compositionSource.includes(concreteModule), true);
  assert.equal(portfolioSource.includes("ports/simulation/buy_execution_model"), true);
  assert.equal(applicationSource.includes("ports/simulation/buy_execution_model"), true);
});
