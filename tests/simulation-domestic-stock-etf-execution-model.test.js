"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createDomesticStockEtfBuyExecutionModel,
} = require("../src/simulation/execution/domestic_stock_etf_buy_execution_model");
const {
  createLegacyBuyExecutionModel,
} = require("../src/simulation/execution/legacy_buy_execution_model");

function bar(date, open, overrides = {}) {
  return {
    date,
    open,
    high: open * 1.05,
    low: open * 0.95,
    close: open,
    volume: 1000,
    ...overrides,
  };
}

test("domestic stock ETF profile uses 100-share lots, 0.001 tick, T+1 and zero stamp duty", () => {
  const model = createDomesticStockEtfBuyExecutionModel();
  const description = model.describe();

  assert.equal(description.kind, "domestic_stock_etf_next_open");
  assert.equal(description.lotSize, 100);
  assert.equal(description.tickSize, 0.001);
  assert.equal(description.tPlusOne, true);
  assert.equal(description.stampDutyRate, 0);
  assert.equal(description.feesIncluded, true);
  assert.equal(description.slippageIncluded, true);
  assert.equal(description.marketRestrictionsIncluded, true);
  assert.ok(description.qualityIssues.includes("etf_profile_assumes_domestic_stock_etf_t_plus_one"));
  assert.ok(description.qualityIssues.includes("etf_profile_does_not_cover_t_plus_zero_etf_categories"));
});

test("ETF and legacy models share the same next-open execution flow but preserve profile-specific tick and rule metadata", () => {
  const bars = [bar("2026-01-02", 1), bar("2026-01-05", 1.234), bar("2026-01-06", 1.3)];
  const input = {
    bars,
    signalDate: "2026-01-02",
    requestedBudget: 10000,
    cashAvailable: 10000,
  };
  const etf = createDomesticStockEtfBuyExecutionModel().executeBuy(input);
  const legacy = createLegacyBuyExecutionModel().executeBuy(input);

  assert.equal(etf.status, "filled");
  assert.equal(legacy.status, "filled");
  assert.equal(etf.executionDate, "2026-01-05");
  assert.equal(legacy.executionDate, "2026-01-05");
  assert.equal(etf.quantity % 100, 0);
  assert.equal(legacy.quantity % 100, 0);
  assert.equal(etf.fees.stampDuty, 0);
  assert.equal(etf.ruleApproximation, "domestic_stock_etf_current_approximation");
  assert.equal(legacy.ruleApproximation, "legacy_rules_current_defaults");
});
