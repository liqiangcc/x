"use strict";

const { randomUUID } = require("node:crypto");
const { DataMode, OrderSide, PriceView } = require("../core/enums");
const { adverseOpenPrice } = require("./slippage_model");
const { calculateFees, cents } = require("./fee_model");

function createFill({ bar, executionConfig = {}, id = randomUUID(), order }) {
  const price = adverseOpenPrice({
    bar,
    side: order.side,
    slippageRate: executionConfig.slippageRate,
    tickSize: executionConfig.tickSize,
  });
  const grossAmount = cents(price * order.quantity);
  const fees = calculateFees({
    commissionRate: executionConfig.commissionRate,
    grossAmount,
    minimumCommissionYuan: executionConfig.minimumCommissionYuan,
    side: order.side,
    stampDutyRate: executionConfig.stampDutyRate,
  });
  const cashAmount = order.side === OrderSide.BUY
    ? cents(grossAmount + fees.total)
    : cents(grossAmount - fees.total);
  return Object.freeze({
    cashAmount,
    dataMode: DataMode.LEGACY_APPROXIMATE,
    date: bar.date,
    fees,
    grossAmount,
    id,
    orderId: order.id,
    price,
    priceView: PriceView.LEGACY_FORWARD_ADJUSTED,
    quantity: order.quantity,
    ruleApproximation: "legacy_rules_current_defaults",
    side: order.side,
    slippageAmount: cents(Math.abs(price - bar.open) * order.quantity),
  });
}

module.exports = {
  createFill,
};
