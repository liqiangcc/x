"use strict";

const { DEFAULT_SIMULATOR_CONFIG } = require("../../simulator/config/defaults");
const { OrderSide } = require("../../simulator/core/enums");
const { normalizeLegacyRules, validateOrderQuantity } = require("../../simulator/data/legacy_rules");
const { executionBlockReason } = require("../../simulator/mechanisms/a_share_rules");
const { createFill } = require("../../simulator/mechanisms/fill_model");
const { adverseOpenPrice } = require("../../simulator/mechanisms/slippage_model");
const {
  nonNegativeMoney,
  normalizeExecutionBars,
  positiveMoney,
  skippedBuyExecutionResult,
} = require("./execution_model_support");

function normalizeTickSize(value, fallback = 0.01) {
  const normalized = Number(value ?? fallback);
  if (!Number.isFinite(normalized) || normalized <= 0) throw new TypeError("tickSize must be positive.");
  return normalized;
}

function assertProfile(profile) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    throw new TypeError("execution profile must be an object.");
  }
  for (const field of ["kind", "ruleApproximation"]) {
    if (typeof profile[field] !== "string" || !profile[field]) {
      throw new TypeError(`execution profile ${field} must be a non-empty string.`);
    }
  }
  return profile;
}

function normalizeProfileExecutionConfig({ input = {}, profile } = {}) {
  const resolvedProfile = assertProfile(profile);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("executionConfig must be an object.");
  }
  const defaults = DEFAULT_SIMULATOR_CONFIG.execution;
  const rules = normalizeLegacyRules({
    ...defaults,
    ...(resolvedProfile.executionDefaults ?? {}),
    ...input,
  });
  return Object.freeze({
    lotSize: rules.lotSize,
    tPlusOne: rules.tPlusOne,
    slippageRate: rules.slippageRate,
    commissionRate: rules.commissionRate,
    minimumCommissionYuan: rules.minimumCommissionFen / 100,
    stampDutyRate: rules.stampDutyRate,
    tickSize: normalizeTickSize(input.tickSize, resolvedProfile.tickSize ?? 0.01),
    qualityIssues: Object.freeze([
      ...new Set([...(rules.qualityIssues ?? []), ...(resolvedProfile.qualityIssues ?? [])]),
    ].sort()),
  });
}

function createProfiledBuyExecutionModel({ executionConfig = {}, profile } = {}) {
  const resolvedProfile = assertProfile(profile);
  const config = normalizeProfileExecutionConfig({ input: executionConfig, profile: resolvedProfile });
  const blockReason = typeof resolvedProfile.executionBlockReason === "function"
    ? resolvedProfile.executionBlockReason
    : executionBlockReason;

  return Object.freeze({
    describe() {
      return Object.freeze({
        kind: resolvedProfile.kind,
        timing: "next_trading_day_open",
        executionPriceField: "open",
        lotSize: config.lotSize,
        tPlusOne: config.tPlusOne,
        slippageRate: config.slippageRate,
        commissionRate: config.commissionRate,
        minimumCommissionYuan: config.minimumCommissionYuan,
        stampDutyRate: config.stampDutyRate,
        tickSize: config.tickSize,
        feesIncluded: config.commissionRate > 0 || config.minimumCommissionYuan > 0 || config.stampDutyRate > 0,
        slippageIncluded: config.slippageRate > 0,
        marketRestrictionsIncluded: true,
        qualityIssues: config.qualityIssues,
      });
    },

    executeBuy({ bars, signalDate, requestedBudget, cashAvailable, orderIndex = 1 } = {}) {
      const rows = normalizeExecutionBars(bars);
      const budget = positiveMoney(Number(requestedBudget), "requestedBudget");
      const availableCash = nonNegativeMoney(Number(cashAvailable), "cashAvailable");
      const effectiveBudget = Math.min(budget, availableCash);
      const normalizedSignalDate = String(signalDate ?? "");
      const signalIndex = rows.findIndex((bar) => bar.date === normalizedSignalDate);
      if (signalIndex < 0) throw new TypeError(`No Kline bar is available for signal date ${normalizedSignalDate}.`);

      const executionIndex = signalIndex + 1;
      const bar = rows[executionIndex] ?? null;
      if (!bar) {
        return skippedBuyExecutionResult({ status: "skipped_no_execution_bar", reason: "no_next_trading_bar", signalDate: normalizedSignalDate, requestedBudget: budget, effectiveBudget });
      }

      const blocked = blockReason({ bar, side: OrderSide.BUY });
      if (blocked) {
        return skippedBuyExecutionResult({ status: "skipped_market_restriction", reason: blocked, signalDate: normalizedSignalDate, executionDate: bar.date, requestedBudget: budget, effectiveBudget });
      }

      const executionPrice = adverseOpenPrice({ bar, side: OrderSide.BUY, slippageRate: config.slippageRate, tickSize: config.tickSize });
      let quantity = Math.floor((effectiveBudget + Number.EPSILON) / (executionPrice * config.lotSize)) * config.lotSize;
      while (quantity >= config.lotSize) {
        const quantityCheck = validateOrderQuantity({ side: OrderSide.BUY, quantity, lotSize: config.lotSize });
        if (!quantityCheck.accepted) throw new Error(`Execution model produced invalid quantity: ${quantityCheck.reason}.`);
        const orderId = `buy-only-${orderIndex}`;
        const fill = createFill({ bar, executionConfig: config, id: `buy-only-fill-${orderIndex}`, order: { id: orderId, quantity, side: OrderSide.BUY } });
        if (fill.cashAmount <= effectiveBudget + 1e-9) {
          const availableDate = config.tPlusOne ? (rows[executionIndex + 1]?.date ?? bar.date) : bar.date;
          return Object.freeze({
            status: "filled", reason: null, signalDate: normalizedSignalDate, executionDate: bar.date, date: bar.date,
            requestedBudget: budget, effectiveBudget, openPrice: bar.open, price: fill.price, quantity: fill.quantity,
            grossAmount: fill.grossAmount, feeAmount: fill.fees.total, fees: fill.fees, slippageAmount: fill.slippageAmount,
            totalCost: fill.cashAmount, availableDate, ruleApproximation: resolvedProfile.ruleApproximation,
          });
        }
        quantity -= config.lotSize;
      }

      return skippedBuyExecutionResult({ status: "skipped_insufficient_budget", reason: "budget_cannot_cover_one_lot_with_fees", signalDate: normalizedSignalDate, executionDate: bar.date, requestedBudget: budget, effectiveBudget });
    },
  });
}

module.exports = {
  assertProfile,
  createProfiledBuyExecutionModel,
  normalizeProfileExecutionConfig,
  normalizeTickSize,
};
