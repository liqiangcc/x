"use strict";

const { DEFAULT_SIMULATOR_CONFIG } = require("../../simulator/config/defaults");
const { OrderSide } = require("../../simulator/core/enums");
const { normalizeLegacyRules, validateOrderQuantity } = require("../../simulator/data/legacy_rules");
const { executionBlockReason } = require("../../simulator/mechanisms/a_share_rules");
const { createFill } = require("../../simulator/mechanisms/fill_model");
const { adverseOpenPrice } = require("../../simulator/mechanisms/slippage_model");

function positiveMoney(value, field) {
  if (!Number.isFinite(value) || value <= 0) throw new TypeError(`${field} must be positive.`);
  return value;
}

function nonNegativeMoney(value, field) {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${field} must be non-negative.`);
  return value;
}

function normalizeTickSize(value) {
  const normalized = Number(value ?? 0.01);
  if (!Number.isFinite(normalized) || normalized <= 0) throw new TypeError("tickSize must be positive.");
  return normalized;
}

function normalizeExecutionConfig(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("executionConfig must be an object.");
  }
  const defaults = DEFAULT_SIMULATOR_CONFIG.execution;
  const rules = normalizeLegacyRules({ ...defaults, ...input });
  return Object.freeze({
    lotSize: rules.lotSize,
    tPlusOne: rules.tPlusOne,
    slippageRate: rules.slippageRate,
    commissionRate: rules.commissionRate,
    minimumCommissionYuan: rules.minimumCommissionFen / 100,
    stampDutyRate: rules.stampDutyRate,
    tickSize: normalizeTickSize(input.tickSize),
    qualityIssues: Object.freeze([...rules.qualityIssues]),
  });
}

function normalizeBars(bars) {
  if (!Array.isArray(bars)) throw new TypeError("bars must be an array.");
  let previousDate = null;
  return bars.map((bar, index) => {
    const date = String(bar?.date ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new TypeError(`bars[${index}].date must be an ISO date.`);
    if (previousDate && date <= previousDate) throw new TypeError("bars must be strictly ordered by ascending date.");
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

function createLegacyBuyExecutionModel({ executionConfig = {} } = {}) {
  const config = normalizeExecutionConfig(executionConfig);

  return Object.freeze({
    describe() {
      return Object.freeze({
        kind: "legacy_a_share_next_open",
        timing: "next_trading_day_open",
        executionPriceField: "open",
        lotSize: config.lotSize,
        tPlusOne: config.tPlusOne,
        slippageRate: config.slippageRate,
        commissionRate: config.commissionRate,
        minimumCommissionYuan: config.minimumCommissionYuan,
        stampDutyRate: config.stampDutyRate,
        tickSize: config.tickSize,
        feesIncluded: true,
        slippageIncluded: true,
        marketRestrictionsIncluded: true,
        qualityIssues: config.qualityIssues,
      });
    },

    executeBuy({
      bars,
      signalDate,
      requestedBudget,
      cashAvailable,
      orderIndex = 1,
    } = {}) {
      const rows = normalizeBars(bars);
      const budget = positiveMoney(Number(requestedBudget), "requestedBudget");
      const availableCash = nonNegativeMoney(Number(cashAvailable), "cashAvailable");
      const effectiveBudget = Math.min(budget, availableCash);
      const normalizedSignalDate = String(signalDate ?? "");
      const signalIndex = rows.findIndex((bar) => bar.date === normalizedSignalDate);
      if (signalIndex < 0) throw new TypeError(`No Kline bar is available for signal date ${normalizedSignalDate}.`);

      const executionIndex = signalIndex + 1;
      const bar = rows[executionIndex] ?? null;
      if (!bar) {
        return skippedResult({
          status: "skipped_no_execution_bar",
          reason: "no_next_trading_bar",
          signalDate: normalizedSignalDate,
          requestedBudget: budget,
          effectiveBudget,
        });
      }

      const blocked = executionBlockReason({ bar, side: OrderSide.BUY });
      if (blocked) {
        return skippedResult({
          status: "skipped_market_restriction",
          reason: blocked,
          signalDate: normalizedSignalDate,
          executionDate: bar.date,
          requestedBudget: budget,
          effectiveBudget,
        });
      }

      const executionPrice = adverseOpenPrice({
        bar,
        side: OrderSide.BUY,
        slippageRate: config.slippageRate,
        tickSize: config.tickSize,
      });
      let quantity = Math.floor((effectiveBudget + Number.EPSILON) / (executionPrice * config.lotSize)) * config.lotSize;

      while (quantity >= config.lotSize) {
        const quantityCheck = validateOrderQuantity({
          side: OrderSide.BUY,
          quantity,
          lotSize: config.lotSize,
        });
        if (!quantityCheck.accepted) {
          throw new Error(`Execution model produced invalid quantity: ${quantityCheck.reason}.`);
        }
        const orderId = `buy-only-${orderIndex}`;
        const fill = createFill({
          bar,
          executionConfig: config,
          id: `buy-only-fill-${orderIndex}`,
          order: { id: orderId, quantity, side: OrderSide.BUY },
        });
        if (fill.cashAmount <= effectiveBudget + 1e-9) {
          const availableDate = config.tPlusOne
            ? (rows[executionIndex + 1]?.date ?? bar.date)
            : bar.date;
          return Object.freeze({
            status: "filled",
            reason: null,
            signalDate: normalizedSignalDate,
            executionDate: bar.date,
            date: bar.date,
            requestedBudget: budget,
            effectiveBudget,
            openPrice: bar.open,
            price: fill.price,
            quantity: fill.quantity,
            grossAmount: fill.grossAmount,
            feeAmount: fill.fees.total,
            fees: fill.fees,
            slippageAmount: fill.slippageAmount,
            totalCost: fill.cashAmount,
            availableDate,
            ruleApproximation: fill.ruleApproximation,
          });
        }
        quantity -= config.lotSize;
      }

      return skippedResult({
        status: "skipped_insufficient_budget",
        reason: "budget_cannot_cover_one_lot_with_fees",
        signalDate: normalizedSignalDate,
        executionDate: bar.date,
        requestedBudget: budget,
        effectiveBudget,
      });
    },
  });
}

module.exports = {
  createLegacyBuyExecutionModel,
  nonNegativeMoney,
  normalizeExecutionConfig,
  normalizeTickSize,
};
