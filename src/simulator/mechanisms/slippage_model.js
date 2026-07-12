"use strict";

const { OrderSide } = require("../core/enums");

function roundToTick(value, tickSize, direction) {
  const scaled = value / tickSize;
  const ticks = direction === "up" ? Math.ceil(scaled - 1e-10) : Math.floor(scaled + 1e-10);
  return Number((ticks * tickSize).toFixed(8));
}

function adverseOpenPrice({ bar, side, slippageRate = 0.001, tickSize = 0.01 }) {
  if (!Object.values(OrderSide).includes(side)) throw new TypeError("side must be buy or sell.");
  if (!Number.isFinite(slippageRate) || slippageRate < 0) throw new TypeError("slippageRate must be non-negative.");
  if (!Number.isFinite(tickSize) || tickSize <= 0) throw new TypeError("tickSize must be positive.");
  if (![bar?.open, bar?.high, bar?.low].every((value) => Number.isFinite(value) && value > 0) || bar.low > bar.high) {
    const error = new Error("A valid open/high/low bar is required for execution.");
    error.code = "invalid_execution_bar";
    throw error;
  }
  const isBuy = side === OrderSide.BUY;
  const slipped = bar.open * (1 + (isBuy ? slippageRate : -slippageRate));
  const rounded = roundToTick(slipped, tickSize, isBuy ? "up" : "down");
  const lower = Math.max(bar.low, Number.isFinite(bar.limitDownPrice) ? bar.limitDownPrice : -Infinity);
  const upper = Math.min(bar.high, Number.isFinite(bar.limitUpPrice) ? bar.limitUpPrice : Infinity);
  return Math.min(Math.max(rounded, lower), upper);
}

module.exports = {
  adverseOpenPrice,
  roundToTick,
};
