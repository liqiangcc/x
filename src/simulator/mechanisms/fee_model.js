"use strict";

const { OrderSide } = require("../core/enums");

function cents(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function calculateFees({
  grossAmount,
  side,
  commissionRate = 0.0003,
  minimumCommissionYuan = 5,
  stampDutyRate = 0.0005,
}) {
  if (!Number.isFinite(grossAmount) || grossAmount <= 0) throw new TypeError("grossAmount must be positive.");
  if (!Object.values(OrderSide).includes(side)) throw new TypeError("side must be buy or sell.");
  const commission = cents(Math.max(grossAmount * commissionRate, minimumCommissionYuan));
  const stampDuty = side === OrderSide.SELL ? cents(grossAmount * stampDutyRate) : 0;
  return Object.freeze({ commission, stampDuty, total: cents(commission + stampDuty) });
}

module.exports = {
  calculateFees,
  cents,
};
