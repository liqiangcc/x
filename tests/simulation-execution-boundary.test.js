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

test("execution profiles, security master, classification, and concrete models stay behind their own boundaries", () => {
  const legacyModule = "legacy_buy_execution_model";
  const etfModule = "domestic_stock_etf_buy_execution_model";
  const t0EtfModule = "t0_etf_buy_execution_model";
  const frictionlessModule = "frictionless_buy_execution_model";
  const profileCatalogModule = "execution_profile_catalog";
  const profiledModelModule = "profiled_buy_execution_model";
  const executionResolverPortModule = "ports/simulation/buy_execution_model_resolver";
  const executionResolverImplementationModule = "simulation/execution/buy_execution_model_resolver";
  const securityMetadataReaderPortModule = "ports/market/security_metadata_reader";
  const securityMetadataReaderImplementationModule = "ledger_security_metadata_reader";
  const securityMasterReaderPortModule = "ports/market/security_master_reader";
  const securityMasterReaderImplementationModule = "ledger_security_master_reader";
  const securityProfileResolverPortModule = "ports/simulation/security_execution_profile_resolver";
  const securityProfileResolverImplementationModule = "simulation/execution/security_execution_profile_resolver";
  const portfolioSource = source("src/simulation/portfolio/buy_only_portfolio_simulator.js");
  const applicationSource = source("src/application/simulation/simulate_drawdown_buying.js");
  const toolSource = source("src/adapters/mcp/tools/simulation_run_drawdown_buying.js");
  const compositionSource = source("src/adapters/mcp/composition_root.js");
  const executionResolverSource = source("src/simulation/execution/buy_execution_model_resolver.js");
  const securityProfileResolverSource = source("src/simulation/execution/security_execution_profile_resolver.js");
  const securityMetadataReaderSource = source("src/adapters/ledger/ledger_security_metadata_reader.js");
  const securityMasterReaderSource = source("src/adapters/ledger/ledger_security_master_reader.js");
  const catalogSource = source("src/simulation/execution/execution_profile_catalog.js");

  for (const lowerSource of [portfolioSource, applicationSource, toolSource]) {
    assert.equal(lowerSource.includes(legacyModule), false);
    assert.equal(lowerSource.includes(etfModule), false);
    assert.equal(lowerSource.includes(t0EtfModule), false);
    assert.equal(lowerSource.includes(frictionlessModule), false);
    assert.equal(lowerSource.includes(profileCatalogModule), false);
    assert.equal(lowerSource.includes(profiledModelModule), false);
    assert.equal(lowerSource.includes(securityMetadataReaderImplementationModule), false);
    assert.equal(lowerSource.includes(securityMasterReaderImplementationModule), false);
    assert.equal(lowerSource.includes(securityProfileResolverImplementationModule), false);
  }

  assert.equal(applicationSource.includes(executionResolverPortModule), true);
  assert.equal(applicationSource.includes(securityMetadataReaderPortModule), true);
  assert.equal(applicationSource.includes(securityMasterReaderPortModule), false);
  assert.equal(applicationSource.includes(securityProfileResolverPortModule), true);
  assert.equal(toolSource.includes(executionResolverPortModule), true);
  assert.equal(toolSource.includes(securityMetadataReaderPortModule), false);
  assert.equal(toolSource.includes(securityMasterReaderPortModule), false);
  assert.equal(toolSource.includes(securityProfileResolverPortModule), false);

  assert.equal(compositionSource.includes(executionResolverImplementationModule), true);
  assert.equal(compositionSource.includes(securityMetadataReaderImplementationModule), true);
  assert.equal(compositionSource.includes(securityMasterReaderImplementationModule), true);
  assert.equal(compositionSource.includes(securityProfileResolverImplementationModule), true);
  assert.equal(compositionSource.includes(legacyModule), false);
  assert.equal(compositionSource.includes(etfModule), false);
  assert.equal(compositionSource.includes(t0EtfModule), false);
  assert.equal(compositionSource.includes(frictionlessModule), false);
  assert.equal(compositionSource.includes(profileCatalogModule), false);
  assert.equal(compositionSource.includes(profiledModelModule), false);

  // Metadata projection depends on the SecurityMasterReader Port only. It must
  // not own storage selection or reclassify securities itself.
  assert.equal(securityMetadataReaderSource.includes(securityMasterReaderPortModule), true);
  assert.equal(securityMetadataReaderSource.includes(securityMasterReaderImplementationModule), false);
  assert.equal(securityMetadataReaderSource.includes("node:fs"), false);
  assert.equal(securityMetadataReaderSource.includes("data/universe"), false);
  assert.equal(securityMetadataReaderSource.includes("instrumentType: \"a_share\""), false);
  assert.equal(securityMetadataReaderSource.includes("instrumentType: \"etf\""), false);

  // Ledger Security Master owns repository IO and normalization, but never
  // execution-profile selection or execution mechanics.
  assert.equal(securityMasterReaderSource.includes("node:fs"), true);
  assert.equal(securityMasterReaderSource.includes("security_master_record"), true);
  assert.equal(securityMasterReaderSource.includes("legacy_a_share"), false);
  assert.equal(securityMasterReaderSource.includes("domestic_stock_etf"), false);
  assert.equal(securityMasterReaderSource.includes("t0_etf"), false);
  assert.equal(securityMasterReaderSource.includes(profileCatalogModule), false);
  assert.equal(securityMasterReaderSource.includes(profiledModelModule), false);

  // The execution resolver composes generic profile-backed execution plus
  // explicitly exceptional models. It must not regain per-market wrappers.
  assert.equal(executionResolverSource.includes(profileCatalogModule), true);
  assert.equal(executionResolverSource.includes(profiledModelModule), true);
  assert.equal(executionResolverSource.includes(frictionlessModule), true);
  assert.equal(executionResolverSource.includes(legacyModule), false);
  assert.equal(executionResolverSource.includes(etfModule), false);
  assert.equal(executionResolverSource.includes(t0EtfModule), false);

  // Security classification only maps explicit metadata to a public profile id.
  // It must not know execution flow, fees, storage, MCP, or concrete models.
  assert.equal(securityProfileResolverSource.includes(profileCatalogModule), false);
  assert.equal(securityProfileResolverSource.includes(profiledModelModule), false);
  assert.equal(securityProfileResolverSource.includes(frictionlessModule), false);
  assert.equal(securityProfileResolverSource.includes(securityMetadataReaderImplementationModule), false);
  assert.equal(securityProfileResolverSource.includes(securityMasterReaderImplementationModule), false);
  assert.equal(securityProfileResolverSource.includes("adapters/mcp"), false);

  // The profile catalog owns market assumptions only, never execution flow.
  assert.equal(catalogSource.includes(legacyModule), false);
  assert.equal(catalogSource.includes(etfModule), false);
  assert.equal(catalogSource.includes(t0EtfModule), false);
  assert.equal(catalogSource.includes(frictionlessModule), false);
  assert.equal(catalogSource.includes(profiledModelModule), false);

  // T+0 ETF is the acceptance case for profile-only extension. Adding a
  // dedicated concrete model would reintroduce duplicated execution flow.
  assert.equal(
    fs.existsSync(path.join(__dirname, "..", "src/simulation/execution/t0_etf_buy_execution_model.js")),
    false
  );
});
