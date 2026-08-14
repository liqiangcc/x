"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  RESTRICTION_RULE_KINDS,
  SHARE_AVAILABILITY,
  defineExecutionProfile,
} = require("../src/ports/simulation/execution_profile");
const {
  createBuyExecutionModelResolver,
} = require("../src/simulation/execution/buy_execution_model_resolver");

function historicalDomesticEtfProfile() {
  return defineExecutionProfile({
    id: "domestic_stock_etf",
    assetClass: "historical_domestic_stock_etf",
    kind: "historical_domestic_stock_etf_next_open",
    ruleApproximation: "synthetic_historical_revision",
    settlement: { sharesAvailable: SHARE_AVAILABILITY.NEXT_TRADING_DAY },
    lotRules: { buyLotSize: 200 },
    priceRules: { tickSize: 0.002, slippageRate: 0 },
    feeRules: {
      commissionRate: 0,
      minimumCommissionYuan: 0,
      stampDutyRate: 0,
    },
    restrictionRules: { kind: RESTRICTION_RULE_KINDS.NONE },
    qualityIssues: ["historical_revision_fixture"],
  });
}

test("BuyExecutionModelResolver consumes an already-resolved ExecutionProfile before static catalog fallback", () => {
  const resolver = createBuyExecutionModelResolver();
  const executionProfile = historicalDomesticEtfProfile();

  const historical = resolver.resolve({
    model: "domestic_stock_etf",
    executionProfile,
    executionConfig: {},
  });
  const fallback = resolver.resolve({
    model: "domestic_stock_etf",
    executionConfig: {},
  });
  const description = historical.describe();

  assert.deepEqual(
    {
      profileId: description.profileId,
      assetClass: description.assetClass,
      kind: description.kind,
      lotSize: description.lotSize,
      tickSize: description.tickSize,
      tPlusOne: description.tPlusOne,
    },
    {
      profileId: "domestic_stock_etf",
      assetClass: "historical_domestic_stock_etf",
      kind: "historical_domestic_stock_etf_next_open",
      lotSize: 200,
      tickSize: 0.002,
      tPlusOne: true,
    }
  );
  assert.equal(description.qualityIssues.includes("historical_revision_fixture"), true);

  assert.equal(fallback.describe().kind, "domestic_stock_etf_next_open");
  assert.equal(fallback.describe().tickSize, 0.001);
});

test("resolved profile seam fails closed on malformed, mismatched, or frictionless profiles", () => {
  const resolver = createBuyExecutionModelResolver();
  const executionProfile = historicalDomesticEtfProfile();

  assert.throws(
    () => resolver.resolve({
      model: "t0_etf",
      executionProfile,
      executionConfig: {},
    }),
    /executionProfile.id must match executionModel: t0_etf/
  );

  assert.throws(
    () => resolver.resolve({
      model: "frictionless",
      executionProfile,
      executionConfig: {},
    }),
    /executionProfile cannot be provided for frictionless execution/
  );

  assert.throws(
    () => resolver.resolve({
      model: "domestic_stock_etf",
      executionProfile: {},
      executionConfig: {},
    }),
    /execution profile id must be a non-empty string/
  );
});

test("Phase 2 resolver seam constructs models without owning temporal revision selection", () => {
  const resolverSource = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "src/simulation/execution/buy_execution_model_resolver.js"
    ),
    "utf8"
  );

  assert.match(resolverSource, /assertExecutionProfile/);
  assert.match(resolverSource, /executionProfile/);
  assert.doesNotMatch(
    resolverSource,
    /asOfDate|effectiveFrom|effectiveTo|ExecutionProfileRevision|EffectiveExecutionProfileProvider/
  );
  assert.doesNotMatch(
    resolverSource,
    /execution_profile_revision|effective_execution_profile_provider|execution_profile_timeline_reader/
  );
});
