"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  calculateLegacyFees,
  marketRestriction,
  normalizeLegacyRules,
  validateOrderQuantity,
} = require("../src/simulator/data/legacy_rules");

const config = JSON.parse(fs.readFileSync(
  path.join(__dirname, "..", "config", "simulator", "default.json"),
  "utf8"
));

test("legacy rules load deterministic MVP defaults", () => {
  const rules = normalizeLegacyRules(config);
  assert.equal(rules.dataMode, "legacy_approximate");
  assert.equal(rules.lotSize, 100);
  assert.equal(rules.tPlusOne, true);
  assert.equal(rules.slippageRate, 0.001);
  assert.equal(rules.minimumCommissionFen, 500);
  assert.deepEqual(rules.qualityIssues, [
    "historical_fee_rules_unavailable",
    "market_rule_approximation",
  ]);
});

test("legacy rules enforce buy lots and allow final odd-lot sells", () => {
  assert.deepEqual(validateOrderQuantity({ side: "buy", quantity: 100 }), {
    accepted: true,
    reason: null,
  });
  assert.equal(validateOrderQuantity({ side: "buy", quantity: 50 }).reason, "buy_quantity_not_lot_multiple");
  assert.deepEqual(validateOrderQuantity({
    side: "sell",
    quantity: 50,
    positionQuantity: 50,
  }), { accepted: true, reason: null });
  assert.equal(validateOrderQuantity({
    side: "sell",
    quantity: 50,
    positionQuantity: 150,
  }).reason, "odd_lot_must_sell_all");
  assert.equal(validateOrderQuantity({
    side: "sell",
    quantity: 200,
    positionQuantity: 100,
  }).reason, "insufficient_position");
});

test("legacy fees apply minimum commission and sell-only stamp duty", () => {
  const rules = normalizeLegacyRules(config);
  assert.deepEqual(calculateLegacyFees({ grossAmountFen: 1000000, side: "buy", rules }), {
    commissionFen: 500,
    stampDutyFen: 0,
    transferFeeFen: 0,
    totalFeeFen: 500,
    qualityIssues: rules.qualityIssues,
  });
  assert.deepEqual(calculateLegacyFees({ grossAmountFen: 1000000, side: "sell", rules }), {
    commissionFen: 500,
    stampDutyFen: 500,
    transferFeeFen: 0,
    totalFeeFen: 1000,
    qualityIssues: rules.qualityIssues,
  });
  assert.equal(calculateLegacyFees({ grossAmountFen: 10000000, side: "buy", rules }).commissionFen, 3000);
});

test("legacy market restrictions block suspension and one-price limits", () => {
  assert.deepEqual(marketRestriction({ bar: { suspended: true }, side: "buy" }), {
    tradable: false,
    reason: "suspended",
  });
  assert.equal(marketRestriction({
    bar: { open: 11, high: 11, low: 11, close: 11, limitUp: true },
    side: "buy",
  }).reason, "limit_up_open");
  assert.equal(marketRestriction({
    bar: { open: 9, high: 9, low: 9, close: 9, limitDown: true },
    side: "sell",
  }).reason, "limit_down_open");
  assert.deepEqual(marketRestriction({
    bar: { open: 10, high: 10.5, low: 9.8, close: 10.2 },
    side: "buy",
  }), { tradable: true, reason: null });
});

test("legacy rules reject invalid values", () => {
  assert.throws(() => normalizeLegacyRules({ lotSize: 0 }), /lotSize/);
  assert.throws(() => normalizeLegacyRules({ commissionRate: 1 }), /commissionRate/);
  assert.throws(() => calculateLegacyFees({ grossAmountFen: -1, side: "buy", rules: config }), /grossAmountFen/);
  assert.equal(marketRestriction({
    bar: { open: -1, high: -1, low: -1, close: -1 },
    side: "buy",
  }).reason, "invalid_execution_price");
});
