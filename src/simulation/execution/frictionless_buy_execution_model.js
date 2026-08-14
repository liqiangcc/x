"use strict";

const { roundMoney } = require("../../simulator/core/position");
const {
  nonNegativeMoney,
  normalizeExecutionBars,
  positiveMoney,
  resolveNextExecutionBar,
  skippedBuyExecutionResult,
} = require("./execution_model_support");

function normalizeLotSize(value) {
  const normalized = value ?? 100;
  if (!Number.isInteger(normalized) || normalized < 1) {
    throw new TypeError("lotSize must be a positive integer.");
  }
  return normalized;
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
      const rows = normalizeExecutionBars(bars);
      const budget = positiveMoney(Number(requestedBudget), "requestedBudget");
      const availableCash = nonNegativeMoney(Number(cashAvailable), "cashAvailable");
      const effectiveBudget = Math.min(budget, availableCash);
      const timing = resolveNextExecutionBar(rows, signalDate);
      const normalizedSignalDate = timing.signalDate;
      const bar = timing.bar;
      if (!bar) {
        return skippedBuyExecutionResult({
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
        return skippedBuyExecutionResult({
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
