"use strict";

const { roundMoney } = require("../../simulator/core/position");

function positiveMoney(value, field) {
  if (!Number.isFinite(value) || value <= 0) throw new TypeError(`${field} must be positive.`);
  return value;
}

function nonNegativeMoney(value, field) {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${field} must be non-negative.`);
  return value;
}

function normalizeLotSize(value) {
  const normalized = value ?? 100;
  if (!Number.isInteger(normalized) || normalized < 1) {
    throw new TypeError("lotSize must be a positive integer.");
  }
  return normalized;
}

function normalizeBars(bars) {
  if (!Array.isArray(bars)) throw new TypeError("bars must be an array.");
  let previousDate = null;
  return bars.map((bar, index) => {
    const date = String(bar?.date ?? "");
    const open = Number(bar?.open);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new TypeError(`bars[${index}].date must be an ISO date.`);
    if (previousDate && date <= previousDate) throw new TypeError("bars must be strictly ordered by ascending date.");
    if (!Number.isFinite(open) || open <= 0) throw new TypeError(`bars[${index}].open must be positive.`);
    previousDate = date;
    return bar;
  });
}

function skippedResult({ status, reason, signalDate, executionDate = null, requestedBudget, effectiveBudget }) {
  return Object.freeze({
    status,
    reason,
    signalDate,
    executionDate,
    date: executionDate ?? signalDate,
    requestedBudget,
    effectiveBudget,
    price: null,
    quantity: 0,
    grossAmount: 0,
    feeAmount: 0,
    fees: Object.freeze({ commission: 0, stampDuty: 0, total: 0 }),
    slippageAmount: 0,
    totalCost: 0,
    availableDate: null,
  });
}

function createFrictionlessBuyExecutionModel({ executionConfig = {} } = {}) {
  if (!executionConfig || typeof executionConfig !== "object" || Array.isArray(executionConfig)) {
    throw new TypeError("executionConfig must be an object.");
  }
  const lotSize = normalizeLotSize(executionConfig.lotSize);

  return Object.freeze({
    describe() {
      return Object.freeze({
        kind: "frictionless_next_open",
        timing: "next_trading_day_open",
        executionPriceField: "open",
        lotSize,
        tPlusOne: false,
        slippageRate: 0,
        commissionRate: 0,
        minimumCommissionYuan: 0,
        stampDutyRate: 0,
        feesIncluded: false,
        slippageIncluded: false,
        marketRestrictionsIncluded: false,
        qualityIssues: Object.freeze([
          "frictionless_execution_ignores_fees_slippage_and_market_restrictions",
        ]),
      });
    },

    executeBuy({
      bars,
      signalDate,
      requestedBudget,
      cashAvailable,
    } = {}) {
      const rows = normalizeBars(bars);
      const budget = positiveMoney(Number(requestedBudget), "requestedBudget");
      const availableCash = nonNegativeMoney(Number(cashAvailable), "cashAvailable");
      const effectiveBudget = Math.min(budget, availableCash);
      const normalizedSignalDate = String(signalDate ?? "");
      const signalIndex = rows.findIndex((bar) => bar.date === normalizedSignalDate);
      if (signalIndex < 0) throw new TypeError(`No Kline bar is available for signal date ${normalizedSignalDate}.`);

      const bar = rows[signalIndex + 1] ?? null;
      if (!bar) {
        return skippedResult({
          status: "skipped_no_execution_bar",
          reason: "no_next_trading_bar",
          signalDate: normalizedSignalDate,
          requestedBudget: budget,
          effectiveBudget,
        });
      }

      const price = Number(bar.open);
      const quantity = Math.floor((effectiveBudget + Number.EPSILON) / (price * lotSize)) * lotSize;
      if (quantity < lotSize) {
        return skippedResult({
          status: "skipped_insufficient_budget",
          reason: "budget_cannot_cover_one_lot",
          signalDate: normalizedSignalDate,
          executionDate: bar.date,
          requestedBudget: budget,
          effectiveBudget,
        });
      }

      const grossAmount = roundMoney(price * quantity);
      return Object.freeze({
        status: "filled",
        reason: null,
        signalDate: normalizedSignalDate,
        executionDate: bar.date,
        date: bar.date,
        requestedBudget: budget,
        effectiveBudget,
        openPrice: price,
        price,
        quantity,
        grossAmount,
        feeAmount: 0,
        fees: Object.freeze({ commission: 0, stampDuty: 0, total: 0 }),
        slippageAmount: 0,
        totalCost: grossAmount,
        availableDate: bar.date,
        ruleApproximation: "frictionless",
      });
    },
  });
}

module.exports = {
  createFrictionlessBuyExecutionModel,
  normalizeLotSize,
};
