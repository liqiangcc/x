"use strict";

const { Account } = require("../../simulator/core/account");
const { normalizeSecurityId, securityKey } = require("../../simulator/core/contracts");
const { roundMoney } = require("../../simulator/core/position");

const PRICE_FIELDS = Object.freeze(["open", "close", "high", "low"]);

function normalizePositiveMoney(value, field) {
  if (!Number.isFinite(value) || value <= 0) throw new TypeError(`${field} must be positive.`);
  return value;
}

function normalizeLotSize(value) {
  const normalized = value ?? 1;
  if (!Number.isInteger(normalized) || normalized < 1) {
    throw new TypeError("lotSize must be a positive integer.");
  }
  return normalized;
}

function normalizePriceField(value) {
  const normalized = value ?? "close";
  if (!PRICE_FIELDS.includes(normalized)) {
    throw new TypeError(`priceField must be one of: ${PRICE_FIELDS.join(", ")}.`);
  }
  return normalized;
}

function indexBars(bars, priceField) {
  if (!Array.isArray(bars)) throw new TypeError("bars must be an array.");
  const indexed = new Map();
  let previousDate = null;
  for (const [index, bar] of bars.entries()) {
    const date = String(bar?.date ?? "");
    const price = Number(bar?.[priceField]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new TypeError(`bars[${index}].date must be an ISO date.`);
    if (previousDate && date <= previousDate) throw new TypeError("bars must be strictly ordered by ascending date.");
    if (!Number.isFinite(price) || price <= 0) throw new TypeError(`bars[${index}].${priceField} must be positive.`);
    indexed.set(date, { date, price });
    previousDate = date;
  }
  return indexed;
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

function simulateBuyOrders({
  bars,
  orders,
  security,
  initialCash = 100000,
  lotSize = 1,
  priceField = "close",
} = {}) {
  const normalizedSecurity = normalizeSecurityId(security);
  const normalizedInitialCash = normalizePositiveMoney(Number(initialCash), "initialCash");
  const normalizedLotSize = normalizeLotSize(lotSize);
  const normalizedPriceField = normalizePriceField(priceField);
  const barIndex = indexBars(bars, normalizedPriceField);
  const normalizedOrders = normalizeOrders(orders);
  const account = new Account({ initialCash: normalizedInitialCash });
  const trades = [];

  for (const [index, order] of normalizedOrders.entries()) {
    const point = barIndex.get(order.date);
    if (!point) throw new TypeError(`No ${normalizedPriceField} price is available for order date ${order.date}.`);
    const effectiveBudget = Math.min(order.budget, account.cashAvailable);
    const lots = Math.floor((effectiveBudget + Number.EPSILON) / (point.price * normalizedLotSize));
    const quantity = lots * normalizedLotSize;

    if (quantity < normalizedLotSize) {
      trades.push(Object.freeze({
        index: index + 1,
        date: order.date,
        status: "skipped_insufficient_budget",
        requestedBudget: order.budget,
        effectiveBudget,
        price: point.price,
        quantity: 0,
        totalCost: 0,
        metadata: Object.freeze(order.metadata),
      }));
      continue;
    }

    const totalCost = roundMoney(quantity * point.price);
    const orderId = `buy-only-${index + 1}`;
    account.freezeBuy({ amount: totalCost, orderId });
    account.settleBuy({
      availableDate: order.date,
      fees: 0,
      orderId,
      quantity,
      security: normalizedSecurity,
      totalCost,
    });
    account.openTradingDate(order.date);
    trades.push(Object.freeze({
      index: index + 1,
      date: order.date,
      status: "filled",
      requestedBudget: order.budget,
      effectiveBudget,
      price: point.price,
      quantity,
      totalCost,
      metadata: Object.freeze(order.metadata),
    }));
  }

  const lastPoint = [...barIndex.values()].at(-1) ?? null;
  const key = securityKey(normalizedSecurity);
  const snapshot = account.snapshot({
    prices: lastPoint ? { [key]: lastPoint.price } : {},
  });
  const filledTrades = trades.filter((trade) => trade.status === "filled");
  const position = snapshot.positions[0] ?? null;

  return Object.freeze({
    security: normalizedSecurity,
    trades: Object.freeze(trades),
    summary: Object.freeze({
      initialCash: normalizedInitialCash,
      filledTradeCount: filledTrades.length,
      skippedTradeCount: trades.length - filledTrades.length,
      investedAmount: roundMoney(filledTrades.reduce((sum, trade) => sum + trade.totalCost, 0)),
      remainingCash: snapshot.cash,
      quantity: position?.quantity ?? 0,
      averageCost: position?.averageCost ?? 0,
      finalPrice: lastPoint?.price ?? null,
      marketValue: snapshot.marketValue,
      equity: snapshot.equity,
      unrealizedPnl: snapshot.unrealizedPnl,
      totalReturn: snapshot.equity / normalizedInitialCash - 1,
    }),
    config: Object.freeze({
      lotSize: normalizedLotSize,
      priceField: normalizedPriceField,
      feesIncluded: false,
      slippageIncluded: false,
    }),
  });
}

module.exports = {
  PRICE_FIELDS,
  indexBars,
  normalizeLotSize,
  normalizeOrders,
  normalizePriceField,
  simulateBuyOrders,
};
