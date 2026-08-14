"use strict";

const { Account } = require("../../simulator/core/account");
const { normalizeSecurityId, securityKey } = require("../../simulator/core/contracts");
const { roundMoney } = require("../../simulator/core/position");
const { assertBuyExecutionModel } = require("../../ports/simulation/buy_execution_model");
const {
  assertBuyExecutionModelProvider,
} = require("../../ports/simulation/buy_execution_model_provider");

const PRICE_FIELDS = Object.freeze(["open", "close", "high", "low"]);

function normalizePositiveMoney(value, field) {
  if (!Number.isFinite(value) || value <= 0) throw new TypeError(`${field} must be positive.`);
  return value;
}

function normalizePriceField(value) {
  const normalized = value ?? "close";
  if (!PRICE_FIELDS.includes(normalized)) {
    throw new TypeError(`priceField must be one of: ${PRICE_FIELDS.join(", ")}.`);
  }
  return normalized;
}

function normalizeBars(bars, priceField) {
  if (!Array.isArray(bars)) throw new TypeError("bars must be an array.");
  let previousDate = null;
  return bars.map((bar, index) => {
    const date = String(bar?.date ?? "");
    const markPrice = Number(bar?.[priceField]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new TypeError(`bars[${index}].date must be an ISO date.`);
    if (previousDate && date <= previousDate) throw new TypeError("bars must be strictly ordered by ascending date.");
    if (!Number.isFinite(markPrice) || markPrice <= 0) throw new TypeError(`bars[${index}].${priceField} must be positive.`);
    previousDate = date;
    return { ...bar, date, markPrice };
  });
}

function normalizeOrders(orders) {
  if (!Array.isArray(orders)) throw new TypeError("orders must be an array.");
  let previousDate = null;
  return orders.map((order, index) => {
    const date = String(order?.date ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new TypeError(`orders[${index}].date must be an ISO date.`);
    if (previousDate && date < previousDate) throw new TypeError("orders must be ordered by ascending date.");
    previousDate = date;
    return {
      date,
      budget: normalizePositiveMoney(Number(order?.budget), `orders[${index}].budget`),
      metadata: order?.metadata && typeof order.metadata === "object" && !Array.isArray(order.metadata)
        ? { ...order.metadata }
        : {},
    };
  });
}

function normalizeExecutionSelection({ executionModel, executionModelProvider }) {
  const hasModel = executionModel !== undefined && executionModel !== null;
  const hasProvider = executionModelProvider !== undefined && executionModelProvider !== null;
  if (hasModel === hasProvider) {
    throw new TypeError("exactly one of executionModel or executionModelProvider is required.");
  }
  return Object.freeze({
    executionModel: hasModel ? assertBuyExecutionModel(executionModel) : null,
    executionModelProvider: hasProvider
      ? assertBuyExecutionModelProvider(executionModelProvider)
      : null,
  });
}

function describeUsedModel(target, model) {
  const description = model.describe();
  const key = JSON.stringify(description);
  if (!target.has(key)) target.set(key, Object.freeze({ ...description }));
}

function simulateBuyOrders({
  bars,
  orders,
  security,
  initialCash = 100000,
  priceField = "close",
  executionModel = null,
  executionModelProvider = null,
} = {}) {
  const normalizedSecurity = normalizeSecurityId(security);
  const normalizedInitialCash = normalizePositiveMoney(Number(initialCash), "initialCash");
  const normalizedPriceField = normalizePriceField(priceField);
  const rows = normalizeBars(bars, normalizedPriceField);
  const normalizedOrders = normalizeOrders(orders);
  const executionSelection = normalizeExecutionSelection({
    executionModel,
    executionModelProvider,
  });
  const account = new Account({ initialCash: normalizedInitialCash });
  const trades = [];
  const usedExecutionModels = new Map();

  for (const [index, order] of normalizedOrders.entries()) {
    const selectedExecutionModel = executionSelection.executionModel
      ?? assertBuyExecutionModel(
        executionSelection.executionModelProvider.resolveForBuy({
          bars: rows,
          signalDate: order.date,
        })
      );
    describeUsedModel(usedExecutionModels, selectedExecutionModel);
    const execution = selectedExecutionModel.executeBuy({
      bars: rows,
      signalDate: order.date,
      requestedBudget: order.budget,
      cashAvailable: account.cashAvailable,
      security: normalizedSecurity,
      orderIndex: index + 1,
    });
    const trade = Object.freeze({
      index: index + 1,
      ...execution,
      metadata: Object.freeze(order.metadata),
    });
    trades.push(trade);
    if (execution.status !== "filled") continue;

    account.openTradingDate(execution.executionDate);
    const orderId = `buy-only-${index + 1}`;
    account.freezeBuy({ amount: execution.totalCost, orderId });
    account.settleBuy({
      availableDate: execution.availableDate,
      fees: execution.feeAmount,
      orderId,
      quantity: execution.quantity,
      security: normalizedSecurity,
      totalCost: execution.totalCost,
    });
  }

  const lastPoint = rows.at(-1) ?? null;
  if (lastPoint) account.openTradingDate(lastPoint.date);
  const key = securityKey(normalizedSecurity);
  const snapshot = account.snapshot({
    prices: lastPoint ? { [key]: lastPoint.markPrice } : {},
  });
  const filledTrades = trades.filter((trade) => trade.status === "filled");
  const position = snapshot.positions[0] ?? null;
  const executionConfig = executionSelection.executionModel
    ? {
        priceField: normalizedPriceField,
        signalPriceField: normalizedPriceField,
        ...executionSelection.executionModel.describe(),
      }
    : {
        priceField: normalizedPriceField,
        signalPriceField: normalizedPriceField,
        executionMode: "date_aware",
        executionModels: Object.freeze([...usedExecutionModels.values()]),
      };

  return Object.freeze({
    security: normalizedSecurity,
    trades: Object.freeze(trades),
    summary: Object.freeze({
      initialCash: normalizedInitialCash,
      filledTradeCount: filledTrades.length,
      skippedTradeCount: trades.length - filledTrades.length,
      investedAmount: roundMoney(filledTrades.reduce((sum, trade) => sum + trade.totalCost, 0)),
      grossAmount: roundMoney(filledTrades.reduce((sum, trade) => sum + trade.grossAmount, 0)),
      totalFees: snapshot.totalFees,
      totalSlippage: roundMoney(filledTrades.reduce((sum, trade) => sum + trade.slippageAmount, 0)),
      remainingCash: snapshot.cash,
      quantity: position?.quantity ?? 0,
      averageCost: position?.averageCost ?? 0,
      finalPrice: lastPoint?.markPrice ?? null,
      marketValue: snapshot.marketValue,
      equity: snapshot.equity,
      unrealizedPnl: snapshot.unrealizedPnl,
      totalReturn: roundMoney(snapshot.equity / normalizedInitialCash - 1),
    }),
    config: Object.freeze(executionConfig),
  });
}

module.exports = {
  PRICE_FIELDS,
  describeUsedModel,
  normalizeBars,
  normalizeExecutionSelection,
  normalizeOrders,
  normalizePriceField,
  simulateBuyOrders,
};
