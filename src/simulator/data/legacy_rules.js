"use strict";

const { DataMode, OrderSide } = require("../core/enums");

const YUAN_TO_FEN = 100;

function toFen(yuan) {
  if (!Number.isFinite(yuan) || yuan < 0) {
    throw new TypeError("yuan must be a non-negative finite number.");
  }
  return Math.round(yuan * YUAN_TO_FEN);
}

function validateRate(value, field) {
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new TypeError(`${field} must be a rate between 0 and 1.`);
  }
  return value;
}

function normalizeLegacyRules(input = {}) {
  const rules = {
    version: Number(input.version ?? 1),
    dataMode: input.dataMode ?? DataMode.LEGACY_APPROXIMATE,
    lotSize: Number(input.lotSize ?? 100),
    tPlusOne: input.tPlusOne ?? true,
    slippageRate: Number(input.slippageRate ?? 0.001),
    commissionRate: Number(input.commissionRate ?? 0.0003),
    minimumCommissionFen: toFen(Number(input.minimumCommissionYuan ?? 5)),
    stampDutyRate: Number(input.stampDutyRate ?? 0.0005),
    qualityIssues: [...new Set(input.ruleQualityIssues ?? [
      "historical_fee_rules_unavailable",
      "market_rule_approximation",
    ])].sort(),
  };
  if (rules.version !== 1) throw new TypeError("Unsupported legacy rule version.");
  if (rules.dataMode !== DataMode.LEGACY_APPROXIMATE) {
    throw new TypeError("Legacy rules require legacy_approximate data mode.");
  }
  if (!Number.isInteger(rules.lotSize) || rules.lotSize < 1) {
    throw new TypeError("lotSize must be a positive integer.");
  }
  if (typeof rules.tPlusOne !== "boolean") throw new TypeError("tPlusOne must be boolean.");
  validateRate(rules.slippageRate, "slippageRate");
  validateRate(rules.commissionRate, "commissionRate");
  validateRate(rules.stampDutyRate, "stampDutyRate");
  return Object.freeze(rules);
}

function validateOrderQuantity({ side, quantity, positionQuantity = 0, lotSize = 100 }) {
  if (!Object.values(OrderSide).includes(side)) {
    return { accepted: false, reason: "invalid_order_side" };
  }
  if (!Number.isInteger(quantity) || quantity < 1) {
    return { accepted: false, reason: "invalid_order_quantity" };
  }
  if (side === OrderSide.BUY && quantity % lotSize !== 0) {
    return { accepted: false, reason: "buy_quantity_not_lot_multiple" };
  }
  if (side === OrderSide.SELL) {
    if (!Number.isInteger(positionQuantity) || positionQuantity < quantity) {
      return { accepted: false, reason: "insufficient_position" };
    }
    if (quantity % lotSize !== 0 && quantity !== positionQuantity) {
      return { accepted: false, reason: "odd_lot_must_sell_all" };
    }
  }
  return { accepted: true, reason: null };
}

function calculateLegacyFees({ grossAmountFen, side, rules }) {
  if (!Number.isInteger(grossAmountFen) || grossAmountFen < 0) {
    throw new TypeError("grossAmountFen must be a non-negative integer.");
  }
  if (!Object.values(OrderSide).includes(side)) {
    throw new TypeError("side must be buy or sell.");
  }
  const normalized = normalizeLegacyRules(rules);
  const commissionFen = Math.max(
    normalized.minimumCommissionFen,
    Math.round(grossAmountFen * normalized.commissionRate)
  );
  const stampDutyFen = side === OrderSide.SELL
    ? Math.round(grossAmountFen * normalized.stampDutyRate)
    : 0;
  return {
    commissionFen,
    stampDutyFen,
    transferFeeFen: 0,
    totalFeeFen: commissionFen + stampDutyFen,
    qualityIssues: normalized.qualityIssues,
  };
}

function marketRestriction({ bar, side }) {
  if (!bar || bar.suspended === true) {
    return { tradable: false, reason: "suspended" };
  }
  if (![bar.open, bar.high, bar.low, bar.close].every((value) => Number.isFinite(value) && value > 0)) {
    return { tradable: false, reason: "invalid_execution_price" };
  }
  const onePrice = bar.open === bar.high && bar.high === bar.low;
  if (side === OrderSide.BUY && bar.limitUp === true && onePrice) {
    return { tradable: false, reason: "limit_up_open" };
  }
  if (side === OrderSide.SELL && bar.limitDown === true && onePrice) {
    return { tradable: false, reason: "limit_down_open" };
  }
  return { tradable: true, reason: null };
}

module.exports = {
  YUAN_TO_FEN,
  calculateLegacyFees,
  marketRestriction,
  normalizeLegacyRules,
  toFen,
  validateOrderQuantity,
};
