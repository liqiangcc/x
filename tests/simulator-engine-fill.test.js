"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { DataMode, OrderSide, PriceView } = require("../src/simulator/core/enums");
const { calculateFees } = require("../src/simulator/mechanisms/fee_model");
const { createFill } = require("../src/simulator/mechanisms/fill_model");
const { adverseOpenPrice } = require("../src/simulator/mechanisms/slippage_model");

const CONFIG = {
  commissionRate: 0.0003,
  minimumCommissionYuan: 5,
  slippageRate: 0.001,
  stampDutyRate: 0.0005,
  tickSize: 0.01,
};

test("slippage is adverse, tick-rounded and bounded by the execution bar", () => {
  const bar = { high: 17.8, low: 17.1, open: 17.3 };
  assert.equal(adverseOpenPrice({ bar, side: OrderSide.BUY, slippageRate: 0.001 }), 17.32);
  assert.equal(adverseOpenPrice({ bar, side: OrderSide.SELL, slippageRate: 0.001 }), 17.28);
  assert.equal(adverseOpenPrice({ bar: { ...bar, high: 17.31 }, side: OrderSide.BUY, slippageRate: 0.01 }), 17.31);
  assert.equal(adverseOpenPrice({ bar: { ...bar, low: 17.29 }, side: OrderSide.SELL, slippageRate: 0.01 }), 17.29);
});

test("slippage respects explicit limit price bounds", () => {
  const bar = { high: 12, low: 8, limitDownPrice: 9, limitUpPrice: 11, open: 10 };
  assert.equal(adverseOpenPrice({ bar, side: OrderSide.BUY, slippageRate: 0.2 }), 11);
  assert.equal(adverseOpenPrice({ bar, side: OrderSide.SELL, slippageRate: 0.2 }), 9);
});

test("MVP fees apply minimum commission both ways and stamp duty only on sells", () => {
  assert.deepEqual(calculateFees({ grossAmount: 1000, side: OrderSide.BUY }), { commission: 5, stampDuty: 0, total: 5 });
  assert.deepEqual(calculateFees({ grossAmount: 10000, side: OrderSide.SELL }), { commission: 5, stampDuty: 5, total: 10 });
  assert.deepEqual(calculateFees({ grossAmount: 100000, side: OrderSide.BUY }), { commission: 30, stampDuty: 0, total: 30 });
});

test("each order creates an independent approximate fill with fees", () => {
  const bar = { date: "2026-07-02", high: 17.8, low: 17.1, open: 17.3 };
  const first = createFill({ bar, executionConfig: CONFIG, id: "fill-a", order: { id: "a", quantity: 100, side: OrderSide.BUY } });
  const second = createFill({ bar, executionConfig: CONFIG, id: "fill-b", order: { id: "b", quantity: 100, side: OrderSide.BUY } });
  assert.equal(first.price, 17.32);
  assert.equal(first.grossAmount, 1732);
  assert.equal(first.fees.total, 5);
  assert.equal(first.cashAmount, 1737);
  assert.equal(first.dataMode, DataMode.LEGACY_APPROXIMATE);
  assert.equal(first.priceView, PriceView.LEGACY_FORWARD_ADJUSTED);
  assert.notEqual(first.orderId, second.orderId);
  assert.notEqual(first.id, second.id);
});
