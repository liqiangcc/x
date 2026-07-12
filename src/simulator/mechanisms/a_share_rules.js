"use strict";

const { OrderSide } = require("../core/enums");

function samePrice(left, right) {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) < 1e-8;
}

function executionBlockReason({ bar, side }) {
  if (!bar || bar.suspended === true || bar.volume === 0 || !Number.isFinite(bar.open) || bar.open <= 0) {
    return "suspended_or_missing_open";
  }
  if (side === OrderSide.BUY && (bar.limitUp === true || samePrice(bar.open, bar.limitUpPrice))) {
    return "buy_at_limit_up_open";
  }
  if (side === OrderSide.SELL && (bar.limitDown === true || samePrice(bar.open, bar.limitDownPrice))) {
    return "sell_at_limit_down_open";
  }
  return null;
}

module.exports = {
  executionBlockReason,
  samePrice,
};
