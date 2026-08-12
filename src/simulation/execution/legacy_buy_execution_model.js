"use strict";

const {
  LEGACY_A_SHARE_EXECUTION_PROFILE,
} = require("./execution_profile_catalog");
const {
  createProfiledBuyExecutionModel,
  normalizeProfileExecutionConfig,
  normalizeTickSize,
} = require("./profiled_buy_execution_model");
const { nonNegativeMoney } = require("./execution_model_support");

const LEGACY_A_SHARE_BUY_PROFILE = LEGACY_A_SHARE_EXECUTION_PROFILE;

function normalizeExecutionConfig(input = {}) {
  return normalizeProfileExecutionConfig({
    input,
    profile: LEGACY_A_SHARE_EXECUTION_PROFILE,
  });
}

function createLegacyBuyExecutionModel({ executionConfig = {} } = {}) {
  return createProfiledBuyExecutionModel({
    executionConfig,
    profile: LEGACY_A_SHARE_EXECUTION_PROFILE,
  });
}

module.exports = {
  LEGACY_A_SHARE_BUY_PROFILE,
  createLegacyBuyExecutionModel,
  nonNegativeMoney,
  normalizeExecutionConfig,
  normalizeTickSize,
};
