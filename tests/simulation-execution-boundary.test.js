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

test("portfolio requires exactly one execution selection capability instead of constructing concrete implementations", () => {
  assert.throws(
    () => simulateBuyOrders({
      bars: [],
      orders: [],
      security: { code: "600001", market: 1 },
      initialCash: 1000,
    }),
    /exactly one of executionModel or executionModelProvider is required/
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

test("execution profiles, temporal security master classification, and concrete models stay behind their own boundaries", () => {
  const legacyModule = "legacy_buy_execution_model";
  const etfModule = "domestic_stock_etf_buy_execution_model";
  const t0EtfModule = "t0_etf_buy_execution_model";
  const frictionlessModule = "frictionless_buy_execution_model";
  const profileCatalogModule = "execution_profile_catalog";
  const profiledModelModule = "profiled_buy_execution_model";
  const executionResolverPortModule = "ports/simulation/buy_execution_model_resolver";
  const executionProviderPortModule = "ports/simulation/buy_execution_model_provider";
  const executionResolverImplementationModule = "simulation/execution/buy_execution_model_resolver";
  const timelineExecutionProviderImplementationModule = "simulation/execution/timeline_buy_execution_model_provider";
  const securityMetadataReaderPortModule = "ports/market/security_metadata_reader";
  const securityMetadataReaderImplementationModule = "ledger_security_metadata_reader";
  const securityMasterReaderPortModule = "ports/market/security_master_reader";
  const securityMasterReaderImplementationModule = "ledger_security_master_reader";
  const securityMasterTimelineReaderPortModule = "ports/market/security_master_timeline_reader";
  const securityMasterTimelineReaderImplementationModule = "ledger_security_master_timeline_reader";
  const securityProfileResolverPortModule = "ports/simulation/security_execution_profile_resolver";
  const securityProfileResolverImplementationModule = "simulation/execution/security_execution_profile_resolver";
  const timelineResolverApplicationModule = "application/simulation/resolve_execution_profile_timeline";
  const portfolioSource = source("src/simulation/portfolio/buy_only_portfolio_simulator.js");
  const applicationSource = source("src/application/simulation/simulate_drawdown_buying.js");
  const timelineResolverApplicationSource = source("src/application/simulation/resolve_execution_profile_timeline.js");
  const timelineExecutionProviderSource = source("src/simulation/execution/timeline_buy_execution_model_provider.js");
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
    assert.equal(lowerSource.includes(securityMasterTimelineReaderImplementationModule), false);
    assert.equal(lowerSource.includes(securityProfileResolverImplementationModule), false);
    assert.equal(lowerSource.includes(timelineExecutionProviderImplementationModule), false);
  }

  // Portfolio accepts either a stable model or a date-aware provider only through Ports.
  assert.equal(portfolioSource.includes(executionProviderPortModule), true);
  assert.equal(portfolioSource.includes(executionResolverImplementationModule), false);
  assert.equal(portfolioSource.includes(timelineExecutionProviderImplementationModule), false);

  // Simulation orchestration consumes the execution resolver and optional request-metadata
  // resolver Ports. Repository timeline IO and the concrete provider remain outside it.
  assert.equal(applicationSource.includes(executionResolverPortModule), true);
  assert.equal(applicationSource.includes(securityMetadataReaderPortModule), false);
  assert.equal(applicationSource.includes(securityMasterReaderPortModule), false);
  assert.equal(applicationSource.includes(securityMasterTimelineReaderPortModule), false);
  assert.equal(applicationSource.includes(securityProfileResolverPortModule), true);
  assert.equal(applicationSource.includes(timelineExecutionProviderImplementationModule), false);

  // MCP owns protocol schema only. It may expose public execution model ids, but does not
  // read metadata/master data or construct temporal execution providers.
  assert.equal(toolSource.includes(executionResolverPortModule), true);
  assert.equal(toolSource.includes(securityMetadataReaderPortModule), false);
  assert.equal(toolSource.includes(securityMasterReaderPortModule), false);
  assert.equal(toolSource.includes(securityMasterTimelineReaderPortModule), false);
  assert.equal(toolSource.includes(securityProfileResolverPortModule), false);
  assert.equal(toolSource.includes(timelineExecutionProviderImplementationModule), false);

  // Composition root is the only layer that wires concrete ledger readers, temporal
  // profile resolution, and the concrete date-aware execution provider together.
  assert.equal(compositionSource.includes(executionResolverImplementationModule), true);
  assert.equal(compositionSource.includes(securityMetadataReaderImplementationModule), false);
  assert.equal(compositionSource.includes(securityMasterReaderImplementationModule), true);
  assert.equal(compositionSource.includes(securityMasterTimelineReaderImplementationModule), true);
  assert.equal(compositionSource.includes(securityProfileResolverImplementationModule), true);
  assert.equal(compositionSource.includes(timelineResolverApplicationModule), true);
  assert.equal(compositionSource.includes(timelineExecutionProviderImplementationModule), true);
  assert.equal(compositionSource.includes(legacyModule), false);
  assert.equal(compositionSource.includes(etfModule), false);
  assert.equal(compositionSource.includes(t0EtfModule), false);
  assert.equal(compositionSource.includes(frictionlessModule), false);
  assert.equal(compositionSource.includes(profileCatalogModule), false);
  assert.equal(compositionSource.includes(profiledModelModule), false);

  // Temporal classification Application depends on the timeline Reader and classification
  // resolver Ports, not on filesystem adapters or execution mechanics.
  assert.equal(timelineResolverApplicationSource.includes(securityMasterTimelineReaderPortModule), true);
  assert.equal(timelineResolverApplicationSource.includes(securityProfileResolverPortModule), true);
  assert.equal(timelineResolverApplicationSource.includes(securityMasterTimelineReaderImplementationModule), false);
  assert.equal(timelineResolverApplicationSource.includes(timelineExecutionProviderImplementationModule), false);
  assert.equal(timelineResolverApplicationSource.includes(profileCatalogModule), false);
  assert.equal(timelineResolverApplicationSource.includes(profiledModelModule), false);

  // The date-aware provider resolves profile ids to models but cannot read Security Master
  // data, classify securities, or know MCP.
  assert.equal(timelineExecutionProviderSource.includes(executionResolverPortModule), true);
  assert.equal(timelineExecutionProviderSource.includes(executionProviderPortModule), true);
  assert.equal(timelineExecutionProviderSource.includes(securityMasterReaderPortModule), false);
  assert.equal(timelineExecutionProviderSource.includes(securityMasterTimelineReaderPortModule), false);
  assert.equal(timelineExecutionProviderSource.includes(securityProfileResolverPortModule), false);
  assert.equal(timelineExecutionProviderSource.includes("adapters/mcp"), false);

  // Legacy metadata projection remains isolated behind SecurityMasterReader and does not
  // own storage selection or reclassify securities itself.
  assert.equal(securityMetadataReaderSource.includes(securityMasterReaderPortModule), true);
  assert.equal(securityMetadataReaderSource.includes(securityMasterReaderImplementationModule), false);
  assert.equal(securityMetadataReaderSource.includes("node:fs"), false);
  assert.equal(securityMetadataReaderSource.includes("data/universe"), false);
  assert.equal(securityMetadataReaderSource.includes("instrumentType: \"a_share\""), false);
  assert.equal(securityMetadataReaderSource.includes("instrumentType: \"etf\""), false);

  // Ledger Security Master owns repository IO and normalization, but never execution-profile
  // selection or execution mechanics.
  assert.equal(securityMasterReaderSource.includes("node:fs"), true);
  assert.equal(securityMasterReaderSource.includes("security_master_record"), true);
  assert.equal(securityMasterReaderSource.includes("legacy_a_share"), false);
  assert.equal(securityMasterReaderSource.includes("domestic_stock_etf"), false);
  assert.equal(securityMasterReaderSource.includes("t0_etf"), false);
  assert.equal(securityMasterReaderSource.includes(profileCatalogModule), false);
  assert.equal(securityMasterReaderSource.includes(profiledModelModule), false);

  // The execution resolver composes generic profile-backed execution plus explicitly
  // exceptional models. It must not regain per-market wrappers.
  assert.equal(executionResolverSource.includes(profileCatalogModule), true);
  assert.equal(executionResolverSource.includes(profiledModelModule), true);
  assert.equal(executionResolverSource.includes(frictionlessModule), true);
  assert.equal(executionResolverSource.includes(legacyModule), false);
  assert.equal(executionResolverSource.includes(etfModule), false);
  assert.equal(executionResolverSource.includes(t0EtfModule), false);

  // Security classification only maps explicit metadata to a public profile id.
  assert.equal(securityProfileResolverSource.includes(profileCatalogModule), false);
  assert.equal(securityProfileResolverSource.includes(profiledModelModule), false);
  assert.equal(securityProfileResolverSource.includes(frictionlessModule), false);
  assert.equal(securityProfileResolverSource.includes(securityMetadataReaderImplementationModule), false);
  assert.equal(securityProfileResolverSource.includes(securityMasterReaderImplementationModule), false);
  assert.equal(securityProfileResolverSource.includes(securityMasterTimelineReaderImplementationModule), false);
  assert.equal(securityProfileResolverSource.includes("adapters/mcp"), false);

  // The profile catalog owns market assumptions only, never execution flow.
  assert.equal(catalogSource.includes(legacyModule), false);
  assert.equal(catalogSource.includes(etfModule), false);
  assert.equal(catalogSource.includes(t0EtfModule), false);
  assert.equal(catalogSource.includes(frictionlessModule), false);
  assert.equal(catalogSource.includes(profiledModelModule), false);

  // T+0 ETF remains a profile-only extension; no dedicated concrete wrapper is allowed.
  assert.equal(
    fs.existsSync(path.join(__dirname, "..", "src/simulation/execution/t0_etf_buy_execution_model.js")),
    false
  );
});