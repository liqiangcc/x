"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  BUY_EXECUTION_MODEL_IDS,
  BUY_EXECUTION_MODEL_RESOLVER_METHODS,
  DEFAULT_BUY_EXECUTION_MODEL_ID,
  assertBuyExecutionModelResolver,
  normalizeBuyExecutionModelId,
} = require("../src/ports/simulation/buy_execution_model_resolver");
const {
  RESTRICTION_RULE_KINDS,
  SHARE_AVAILABILITY,
  defineExecutionProfile,
} = require("../src/ports/simulation/execution_profile");
const {
  createExecutionProfileCatalog,
} = require("../src/simulation/execution/execution_profile_catalog");
const {
  createBuyExecutionModelResolver,
} = require("../src/simulation/execution/buy_execution_model_resolver");

test("BuyExecutionModelResolver port owns the public model identifiers and narrow resolve contract", () => {
  assert.deepEqual(BUY_EXECUTION_MODEL_IDS, ["legacy_a_share", "domestic_stock_etf", "frictionless"]);
  assert.deepEqual(BUY_EXECUTION_MODEL_RESOLVER_METHODS, ["resolve"]);
  assert.equal(DEFAULT_BUY_EXECUTION_MODEL_ID, "legacy_a_share");
  assert.equal(normalizeBuyExecutionModelId(), "legacy_a_share");
  assert.equal(normalizeBuyExecutionModelId("domestic_stock_etf"), "domestic_stock_etf");
  assert.equal(normalizeBuyExecutionModelId("frictionless"), "frictionless");
  assert.throws(
    () => normalizeBuyExecutionModelId("unknown"),
    /executionModel must be one of: legacy_a_share, domestic_stock_etf, frictionless/
  );
  assert.throws(() => assertBuyExecutionModelResolver(null), /must be an object/);
  assert.throws(() => assertBuyExecutionModelResolver({}), /missing methods: resolve/);
});

test("registered resolver maps catalog profiles and special models behind the same port", () => {
  const resolver = createBuyExecutionModelResolver();
  assert.equal(assertBuyExecutionModelResolver(resolver), resolver);

  const legacy = resolver.resolve({ model: "legacy_a_share", executionConfig: { lotSize: 10 } });
  const etf = resolver.resolve({ model: "domestic_stock_etf", executionConfig: { lotSize: 100 } });
  const frictionless = resolver.resolve({ model: "frictionless", executionConfig: { lotSize: 10 } });

  assert.equal(legacy.describe().profileId, "legacy_a_share");
  assert.equal(legacy.describe().assetClass, "a_share");
  assert.equal(legacy.describe().kind, "legacy_a_share_next_open");
  assert.equal(legacy.describe().lotSize, 10);
  assert.equal(etf.describe().profileId, "domestic_stock_etf");
  assert.equal(etf.describe().assetClass, "domestic_stock_etf");
  assert.equal(etf.describe().kind, "domestic_stock_etf_next_open");
  assert.equal(etf.describe().lotSize, 100);
  assert.equal(etf.describe().tickSize, 0.001);
  assert.equal(etf.describe().stampDutyRate, 0);
  assert.equal(etf.describe().tPlusOne, true);
  assert.equal(frictionless.describe().kind, "frictionless_next_open");
  assert.equal(frictionless.describe().lotSize, 10);
  assert.equal("profileId" in frictionless.describe(), false);
});

test("resolver can add another profiled market implementation without adding another concrete model factory", () => {
  const customProfile = defineExecutionProfile({
    id: "legacy_a_share",
    assetClass: "custom_asset",
    kind: "custom_profiled_next_open",
    ruleApproximation: "custom_rules",
    settlement: { sharesAvailable: SHARE_AVAILABILITY.SAME_DAY },
    lotRules: { buyLotSize: 50 },
    priceRules: { tickSize: 0.005, slippageRate: 0 },
    feeRules: { commissionRate: 0, minimumCommissionYuan: 0, stampDutyRate: 0 },
    restrictionRules: { kind: RESTRICTION_RULE_KINDS.NONE },
    qualityIssues: ["custom_profile"],
  });
  const etfProfile = defineExecutionProfile({
    ...customProfile,
    id: "domestic_stock_etf",
    kind: "custom_etf_profiled_next_open",
  });
  const profileCatalog = createExecutionProfileCatalog({ profiles: [customProfile, etfProfile] });
  const calls = [];
  const specialModel = {
    executeBuy() { return { status: "skipped" }; },
    describe() { return { kind: "special" }; },
  };
  const resolver = createBuyExecutionModelResolver({
    profileCatalog,
    factories: {
      frictionless(input) {
        calls.push(input);
        return specialModel;
      },
    },
  });

  const profiled = resolver.resolve({ model: "legacy_a_share", executionConfig: {} });
  assert.equal(profiled.describe().kind, "custom_profiled_next_open");
  assert.equal(profiled.describe().lotSize, 50);
  assert.equal(profiled.describe().tickSize, 0.005);
  assert.equal(profiled.describe().tPlusOne, false);
  assert.equal(profiled.describe().feesIncluded, false);
  assert.equal(profiled.describe().marketRestrictionsIncluded, false);
  assert.equal(calls.length, 0);

  assert.equal(resolver.resolve({ model: "frictionless", executionConfig: { lotSize: 10 } }), specialModel);
  assert.deepEqual(calls, [{ executionConfig: { lotSize: 10 } }]);
});

test("resolver fails closed when a public execution model has neither a profile nor a special factory", () => {
  const profileCatalog = createExecutionProfileCatalog({ profiles: [] });
  assert.throws(
    () => createBuyExecutionModelResolver({ profileCatalog, factories: {} }),
    /implementation is missing for: legacy_a_share/
  );
});
