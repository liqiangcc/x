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
  assertBuyExecutionModelResolver,
} = require("../src/ports/simulation/buy_execution_model_resolver");
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

test("simulation use case requires an injected execution model resolver", () => {
  assert.throws(
    () => new SimulateDrawdownBuyingUseCase({ klineReader: fakeKlineReader() }),
    /buyExecutionModelResolver implementation must be an object/
  );
  assert.equal(
    assertBuyExecutionModelResolver(createBuyExecutionModelResolver()).resolve instanceof Function,
    true
  );
});

test("execution profiles and concrete models stay behind the resolver implementation boundary", () => {
  const legacyModule = "legacy_buy_execution_model";
  const etfModule = "domestic_stock_etf_buy_execution_model";
  const frictionlessModule = "frictionless_buy_execution_model";
  const profileCatalogModule = "execution_profile_catalog";
  const profiledModelModule = "profiled_buy_execution_model";
  const resolverPortModule = "ports/simulation/buy_execution_model_resolver";
  const resolverImplementationModule = "simulation/execution/buy_execution_model_resolver";
  const portfolioSource = source("src/simulation/portfolio/buy_only_portfolio_simulator.js");
  const applicationSource = source("src/application/simulation/simulate_drawdown_buying.js");
  const toolSource = source("src/adapters/mcp/tools/simulation_run_drawdown_buying.js");
  const compositionSource = source("src/adapters/mcp/composition_root.js");
  const resolverSource = source("src/simulation/execution/buy_execution_model_resolver.js");
  const catalogSource = source("src/simulation/execution/execution_profile_catalog.js");

  for (const lowerSource of [portfolioSource, applicationSource, toolSource]) {
    assert.equal(lowerSource.includes(legacyModule), false);
    assert.equal(lowerSource.includes(etfModule), false);
    assert.equal(lowerSource.includes(frictionlessModule), false);
    assert.equal(lowerSource.includes(profileCatalogModule), false);
    assert.equal(lowerSource.includes(profiledModelModule), false);
  }

  assert.equal(applicationSource.includes(resolverPortModule), true);
  assert.equal(toolSource.includes(resolverPortModule), true);
  assert.equal(compositionSource.includes(resolverImplementationModule), true);
  assert.equal(compositionSource.includes(legacyModule), false);
  assert.equal(compositionSource.includes(etfModule), false);
  assert.equal(compositionSource.includes(frictionlessModule), false);
  assert.equal(compositionSource.includes(profileCatalogModule), false);
  assert.equal(compositionSource.includes(profiledModelModule), false);

  // The resolver composes generic profile-backed execution plus explicitly
  // exceptional models. It must not regain per-market concrete wrappers.
  assert.equal(resolverSource.includes(profileCatalogModule), true);
  assert.equal(resolverSource.includes(profiledModelModule), true);
  assert.equal(resolverSource.includes(frictionlessModule), true);
  assert.equal(resolverSource.includes(legacyModule), false);
  assert.equal(resolverSource.includes(etfModule), false);

  // The profile catalog owns market assumptions only, never execution flow.
  assert.equal(catalogSource.includes(legacyModule), false);
  assert.equal(catalogSource.includes(etfModule), false);
  assert.equal(catalogSource.includes(frictionlessModule), false);
  assert.equal(catalogSource.includes(profiledModelModule), false);
});
