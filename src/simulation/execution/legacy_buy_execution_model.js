"use strict";

const {
  createProfiledBuyExecutionModel,
  normalizeProfileExecutionConfig,
  normalizeTickSize,
} = require("./profiled_buy_execution_model");
const { nonNegativeMoney } = require("./execution_model_support");

const LEGACY_A_SHARE_BUY_PROFILE = Object.freeze({
  kind: "legacy_a_share_next_open",
  ruleApproximation: "legacy_rules_current_defaults",
  tickSize: 0.01,
  executionDefaults: Object.freeze({
    lotSize: 100,
    tPlusOne: true,
  }),
  qualityIssues: Object.freeze([]),
});

function normalizeExecutionConfig(input = {}) {
  return normalizeProfileExecutionConfig({
    input,
    profile: LEGACY_A_SHARE_BUY_PROFILE,
  });
}

function createLegacyBuyExecutionModel({ executionConfig = {} } = {}) {
  return createProfiledBuyExecutionModel({
    executionConfig,
    profile: LEGACY_A_SHARE_BUY_PROFILE,
  });
}

module.exports = {
  LEGACY_A_SHARE_BUY_PROFILE,
  createLegacyBuyExecutionModel,
  nonNegativeMoney,
  normalizeExecutionConfig,
  normalizeTickSize,
};
