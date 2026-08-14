"use strict";

const {
  RESTRICTION_RULE_KINDS,
  SHARE_AVAILABILITY,
  assertExecutionProfile,
  defineExecutionProfile,
} = require("../../ports/simulation/execution_profile");

const LEGACY_A_SHARE_EXECUTION_PROFILE = defineExecutionProfile({
  id: "legacy_a_share",
  assetClass: "a_share",
  kind: "legacy_a_share_next_open",
  ruleApproximation: "legacy_rules_current_defaults",
  settlement: { sharesAvailable: SHARE_AVAILABILITY.NEXT_TRADING_DAY },
  lotRules: { buyLotSize: 100 },
  priceRules: { tickSize: 0.01 },
  feeRules: {},
  restrictionRules: { kind: RESTRICTION_RULE_KINDS.A_SHARE_MARKET },
  qualityIssues: [],
});

const DOMESTIC_STOCK_ETF_EXECUTION_PROFILE = defineExecutionProfile({
  id: "domestic_stock_etf",
  assetClass: "domestic_stock_etf",
  kind: "domestic_stock_etf_next_open",
  ruleApproximation: "domestic_stock_etf_current_approximation",
  settlement: { sharesAvailable: SHARE_AVAILABILITY.NEXT_TRADING_DAY },
  lotRules: { buyLotSize: 100 },
  priceRules: { tickSize: 0.001 },
  feeRules: { stampDutyRate: 0 },
  restrictionRules: { kind: RESTRICTION_RULE_KINDS.A_SHARE_MARKET },
  qualityIssues: [
    "etf_profile_assumes_domestic_stock_etf_t_plus_one",
    "etf_profile_does_not_cover_t_plus_zero_etf_categories",
  ],
});

const T0_ETF_EXECUTION_PROFILE = defineExecutionProfile({
  id: "t0_etf",
  assetClass: "t0_eligible_etf",
  kind: "t0_etf_next_open",
  ruleApproximation: "t0_etf_current_approximation",
  settlement: { sharesAvailable: SHARE_AVAILABILITY.SAME_DAY },
  lotRules: { buyLotSize: 100 },
  priceRules: { tickSize: 0.001 },
  feeRules: { stampDutyRate: 0 },
  restrictionRules: { kind: RESTRICTION_RULE_KINDS.A_SHARE_MARKET },
  qualityIssues: [
    "t0_etf_profile_requires_exchange_eligible_instrument",
    "t0_etf_profile_uses_shared_a_share_market_restriction_approximation",
  ],
});

const DEFAULT_EXECUTION_PROFILES = Object.freeze([
  LEGACY_A_SHARE_EXECUTION_PROFILE,
  DOMESTIC_STOCK_ETF_EXECUTION_PROFILE,
  T0_ETF_EXECUTION_PROFILE,
]);

function createExecutionProfileCatalog({ profiles = DEFAULT_EXECUTION_PROFILES } = {}) {
  if (!Array.isArray(profiles)) throw new TypeError("execution profiles must be an array.");
  const entries = new Map();
  for (const profile of profiles) {
    assertExecutionProfile(profile);
    if (entries.has(profile.id)) throw new TypeError(`duplicate execution profile id: ${profile.id}.`);
    entries.set(profile.id, profile);
  }
  return Object.freeze({
    get(id) {
      return entries.get(String(id ?? "")) ?? null;
    },
    list() {
      return Object.freeze([...entries.values()]);
    },
  });
}

const DEFAULT_EXECUTION_PROFILE_CATALOG = createExecutionProfileCatalog();

module.exports = {
  DEFAULT_EXECUTION_PROFILES,
  DEFAULT_EXECUTION_PROFILE_CATALOG,
  DOMESTIC_STOCK_ETF_EXECUTION_PROFILE,
  LEGACY_A_SHARE_EXECUTION_PROFILE,
  T0_ETF_EXECUTION_PROFILE,
  createExecutionProfileCatalog,
};
