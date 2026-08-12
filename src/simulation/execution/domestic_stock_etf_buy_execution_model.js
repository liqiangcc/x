"use strict";

const { createProfiledBuyExecutionModel } = require("./profiled_buy_execution_model");

const DOMESTIC_STOCK_ETF_BUY_PROFILE = Object.freeze({
  kind: "domestic_stock_etf_next_open",
  ruleApproximation: "domestic_stock_etf_current_approximation",
  tickSize: 0.001,
  executionDefaults: Object.freeze({
    lotSize: 100,
    tPlusOne: true,
    stampDutyRate: 0,
  }),
  qualityIssues: Object.freeze([
    "etf_profile_assumes_domestic_stock_etf_t_plus_one",
    "etf_profile_does_not_cover_t_plus_zero_etf_categories",
  ]),
});

function createDomesticStockEtfBuyExecutionModel({ executionConfig = {} } = {}) {
  return createProfiledBuyExecutionModel({
    executionConfig,
    profile: DOMESTIC_STOCK_ETF_BUY_PROFILE,
  });
}

module.exports = {
  DOMESTIC_STOCK_ETF_BUY_PROFILE,
  createDomesticStockEtfBuyExecutionModel,
};
