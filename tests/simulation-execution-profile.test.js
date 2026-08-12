"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  RESTRICTION_RULE_KINDS,
  SHARE_AVAILABILITY,
  defineExecutionProfile,
} = require("../src/ports/simulation/execution_profile");
const {
  DEFAULT_EXECUTION_PROFILE_CATALOG,
  DOMESTIC_STOCK_ETF_EXECUTION_PROFILE,
  LEGACY_A_SHARE_EXECUTION_PROFILE,
  createExecutionProfileCatalog,
} = require("../src/simulation/execution/execution_profile_catalog");

function profile(overrides = {}) {
  return {
    id: "test_profile",
    assetClass: "test_asset",
    kind: "test_next_open",
    ruleApproximation: "test_rules",
    settlement: { sharesAvailable: SHARE_AVAILABILITY.NEXT_TRADING_DAY },
    lotRules: { buyLotSize: 100 },
    priceRules: { tickSize: 0.01 },
    feeRules: {},
    restrictionRules: { kind: RESTRICTION_RULE_KINDS.A_SHARE_MARKET },
    qualityIssues: [],
    ...overrides,
  };
}

test("ExecutionProfile contract normalizes immutable market execution data", () => {
  const defined = defineExecutionProfile(profile({ qualityIssues: ["b", "a", "a"] }));
  assert.equal(defined.id, "test_profile");
  assert.equal(defined.settlement.sharesAvailable, "next_trading_day");
  assert.equal(defined.lotRules.buyLotSize, 100);
  assert.equal(defined.priceRules.tickSize, 0.01);
  assert.deepEqual(defined.qualityIssues, ["a", "b"]);
  assert.equal(Object.isFrozen(defined), true);
  assert.equal(Object.isFrozen(defined.settlement), true);
  assert.equal(Object.isFrozen(defined.lotRules), true);
  assert.equal(Object.isFrozen(defined.priceRules), true);
  assert.equal(Object.isFrozen(defined.feeRules), true);
  assert.equal(Object.isFrozen(defined.restrictionRules), true);
});

test("ExecutionProfile contract rejects malformed market rules before model construction", () => {
  assert.throws(() => defineExecutionProfile(profile({ id: "" })), /id must be a non-empty string/);
  assert.throws(
    () => defineExecutionProfile(profile({ settlement: { sharesAvailable: "later" } })),
    /settlement\.sharesAvailable must be one of/
  );
  assert.throws(() => defineExecutionProfile(profile({ lotRules: { buyLotSize: 0 } })), /buyLotSize must be a positive integer/);
  assert.throws(() => defineExecutionProfile(profile({ priceRules: { tickSize: 0 } })), /tickSize must be positive/);
  assert.throws(
    () => defineExecutionProfile(profile({ feeRules: { stampDutyRate: -1 } })),
    /stampDutyRate must be non-negative/
  );
  assert.throws(
    () => defineExecutionProfile(profile({ restrictionRules: { kind: "unknown" } })),
    /restrictionRules\.kind must be one of/
  );
});

test("default execution profile catalog is the single source for legacy and domestic stock ETF market assumptions", () => {
  assert.deepEqual(DEFAULT_EXECUTION_PROFILE_CATALOG.list().map((item) => item.id), [
    "legacy_a_share",
    "domestic_stock_etf",
  ]);
  assert.equal(DEFAULT_EXECUTION_PROFILE_CATALOG.get("legacy_a_share"), LEGACY_A_SHARE_EXECUTION_PROFILE);
  assert.equal(DEFAULT_EXECUTION_PROFILE_CATALOG.get("domestic_stock_etf"), DOMESTIC_STOCK_ETF_EXECUTION_PROFILE);
  assert.equal(DEFAULT_EXECUTION_PROFILE_CATALOG.get("frictionless"), null);

  assert.equal(LEGACY_A_SHARE_EXECUTION_PROFILE.assetClass, "a_share");
  assert.equal(LEGACY_A_SHARE_EXECUTION_PROFILE.lotRules.buyLotSize, 100);
  assert.equal(LEGACY_A_SHARE_EXECUTION_PROFILE.priceRules.tickSize, 0.01);
  assert.deepEqual(LEGACY_A_SHARE_EXECUTION_PROFILE.feeRules, {});

  assert.equal(DOMESTIC_STOCK_ETF_EXECUTION_PROFILE.assetClass, "domestic_stock_etf");
  assert.equal(DOMESTIC_STOCK_ETF_EXECUTION_PROFILE.lotRules.buyLotSize, 100);
  assert.equal(DOMESTIC_STOCK_ETF_EXECUTION_PROFILE.priceRules.tickSize, 0.001);
  assert.equal(DOMESTIC_STOCK_ETF_EXECUTION_PROFILE.feeRules.stampDutyRate, 0);
  assert.ok(DOMESTIC_STOCK_ETF_EXECUTION_PROFILE.qualityIssues.includes("etf_profile_does_not_cover_t_plus_zero_etf_categories"));
});

test("execution profile catalog rejects duplicate ids and supports extension without changing the resolver contract", () => {
  const custom = defineExecutionProfile(profile());
  const catalog = createExecutionProfileCatalog({ profiles: [custom] });
  assert.equal(catalog.get("test_profile"), custom);
  assert.deepEqual(catalog.list(), [custom]);
  assert.throws(() => createExecutionProfileCatalog({ profiles: [custom, custom] }), /duplicate execution profile id/);
});
