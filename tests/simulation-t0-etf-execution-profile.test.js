"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createBuyExecutionModelResolver,
} = require("../src/simulation/execution/buy_execution_model_resolver");

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

test("T+0 ETF is a catalog-backed profile with same-day share availability", () => {
  const model = createBuyExecutionModelResolver().resolve({ model: "t0_etf" });
  const description = model.describe();

  assert.equal(description.profileId, "t0_etf");
  assert.equal(description.assetClass, "t0_eligible_etf");
  assert.equal(description.kind, "t0_etf_next_open");
  assert.equal(description.lotSize, 100);
  assert.equal(description.tickSize, 0.001);
  assert.equal(description.tPlusOne, false);
  assert.equal(description.stampDutyRate, 0);
  assert.equal(description.marketRestrictionsIncluded, true);
  assert.ok(description.qualityIssues.includes("t0_etf_profile_requires_exchange_eligible_instrument"));
  assert.ok(description.qualityIssues.includes("t0_etf_profile_uses_shared_a_share_market_restriction_approximation"));
});

test("T+0 and T+1 ETF profiles share one execution flow and differ only in settlement availability", () => {
  const bars = [
    bar("2026-01-02", 1),
    bar("2026-01-05", 1.234),
    bar("2026-01-06", 1.3),
  ];
  const input = {
    bars,
    signalDate: "2026-01-02",
    requestedBudget: 10000,
    cashAvailable: 10000,
  };
  const resolver = createBuyExecutionModelResolver();
  const t0 = resolver.resolve({ model: "t0_etf" }).executeBuy(input);
  const t1 = resolver.resolve({ model: "domestic_stock_etf" }).executeBuy(input);

  assert.equal(t0.status, "filled");
  assert.equal(t1.status, "filled");
  assert.equal(t0.executionDate, "2026-01-05");
  assert.equal(t1.executionDate, "2026-01-05");
  assert.equal(t0.availableDate, "2026-01-05");
  assert.equal(t1.availableDate, "2026-01-06");
  assert.equal(t0.quantity, t1.quantity);
  assert.equal(t0.price, t1.price);
  assert.equal(t0.totalCost, t1.totalCost);
  assert.equal(t0.ruleApproximation, "t0_etf_current_approximation");
  assert.equal(t1.ruleApproximation, "domestic_stock_etf_current_approximation");
});
