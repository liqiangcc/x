"use strict";

const {
  DOMESTIC_STOCK_ETF_EXECUTION_PROFILE,
} = require("./execution_profile_catalog");
const { createProfiledBuyExecutionModel } = require("./profiled_buy_execution_model");

const DOMESTIC_STOCK_ETF_BUY_PROFILE = DOMESTIC_STOCK_ETF_EXECUTION_PROFILE;

function createDomesticStockEtfBuyExecutionModel({ executionConfig = {} } = {}) {
  return createProfiledBuyExecutionModel({
    executionConfig,
    profile: DOMESTIC_STOCK_ETF_EXECUTION_PROFILE,
  });
}

module.exports = {
  DOMESTIC_STOCK_ETF_BUY_PROFILE,
  createDomesticStockEtfBuyExecutionModel,
};
