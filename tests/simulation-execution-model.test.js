"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
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

test("legacy buy execution model uses next trading day open with shared slippage and fee mechanisms", () => {
  const model = createLegacyBuyExecutionModel({ executionConfig: { lotSize: 10 } });
  const result = model.executeBuy({
    bars: [bar("2026-01-02", 12), bar("2026-01-05", 10), bar("2026-01-06", 11)],
    signalDate: "2026-01-02",
    requestedBudget: 1000,
    cashAvailable: 1000,
    orderIndex: 1,
  });

  assert.equal(result.status, "filled");
  assert.equal(result.signalDate, "2026-01-02");
  assert.equal(result.executionDate, "2026-01-05");
  assert.equal(result.openPrice, 10);
  assert.equal(result.price, 10.01);
  assert.equal(result.quantity, 90);
  assert.equal(result.grossAmount, 900.9);
  assert.equal(result.fees.commission, 5);
  assert.equal(result.fees.stampDuty, 0);
  assert.equal(result.feeAmount, 5);
  assert.equal(result.slippageAmount, 0.9);
  assert.equal(result.totalCost, 905.9);
  assert.equal(result.availableDate, "2026-01-06");

  const description = model.describe();
  assert.equal(description.timing, "next_trading_day_open");
  assert.equal(description.executionPriceField, "open");
  assert.equal(description.lotSize, 10);
  assert.equal(description.feesIncluded, true);
  assert.equal(description.slippageIncluded, true);
  assert.equal(description.marketRestrictionsIncluded, true);
});

test("legacy buy execution model does not fabricate fills when the next bar is blocked or absent", () => {
  const model = createLegacyBuyExecutionModel({ executionConfig: { lotSize: 10 } });
  const blocked = model.executeBuy({
    bars: [
      bar("2026-01-02", 10),
      bar("2026-01-05", 11, { limitUp: true, limitUpPrice: 11 }),
    ],
    signalDate: "2026-01-02",
    requestedBudget: 1000,
    cashAvailable: 1000,
  });
  assert.equal(blocked.status, "skipped_market_restriction");
  assert.equal(blocked.reason, "buy_at_limit_up_open");
  assert.equal(blocked.executionDate, "2026-01-05");
  assert.equal(blocked.quantity, 0);

  const noNextBar = model.executeBuy({
    bars: [bar("2026-01-02", 10)],
    signalDate: "2026-01-02",
    requestedBudget: 1000,
    cashAvailable: 1000,
  });
  assert.equal(noNextBar.status, "skipped_no_execution_bar");
  assert.equal(noNextBar.reason, "no_next_trading_bar");
  assert.equal(noNextBar.executionDate, null);
});

test("legacy buy execution model respects lot size and fees when budget cannot cover one lot", () => {
  const model = createLegacyBuyExecutionModel({ executionConfig: { lotSize: 100 } });
  const result = model.executeBuy({
    bars: [bar("2026-01-02", 10), bar("2026-01-05", 10)],
    signalDate: "2026-01-02",
    requestedBudget: 1000,
    cashAvailable: 1000,
  });
  assert.equal(result.status, "skipped_insufficient_budget");
  assert.equal(result.reason, "budget_cannot_cover_one_lot_with_fees");
  assert.equal(result.quantity, 0);
});
