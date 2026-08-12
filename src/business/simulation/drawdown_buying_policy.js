"use strict";

const DEFAULT_DRAWDOWN_STEP = 0.08;
const DEFAULT_TRANCHE_FRACTION = 0.1;
const DEFAULT_MAX_PURCHASES = 10;
const DEFAULT_INITIAL_DRAWDOWN = 0;
const PRICE_FIELDS = Object.freeze(["open", "close", "high", "low"]);

function rate(value, field, { allowZero = false } = {}) {
  if (!Number.isFinite(value) || value >= 1 || (allowZero ? value < 0 : value <= 0)) {
    throw new TypeError(`${field} must be ${allowZero ? "between 0 (inclusive) and 1" : "between 0 and 1"}.`);
  }
  return value;
}

function normalizeMaxPurchases(value) {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError("maxPurchases must be a positive integer.");
  }
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
    const price = Number(bar?.[priceField]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new TypeError(`bars[${index}].date must be an ISO date.`);
    }
    if (previousDate && date <= previousDate) {
      throw new TypeError("bars must be strictly ordered by ascending date.");
    }
    if (!Number.isFinite(price) || price <= 0) {
      throw new TypeError(`bars[${index}].${priceField} must be positive.`);
    }
    previousDate = date;
    return { date, price };
  });
}

function thresholdReached(price, triggerPrice) {
  const tolerance = Math.max(1, Math.abs(triggerPrice)) * 1e-12;
  return price <= triggerPrice + tolerance;
}

function drawdown(referencePrice, price) {
  return Math.max(0, (referencePrice - price) / referencePrice);
}

function buildDrawdownBuyingPlan(bars, {
  initialDrawdown = DEFAULT_INITIAL_DRAWDOWN,
  drawdownStep = DEFAULT_DRAWDOWN_STEP,
  trancheFraction = DEFAULT_TRANCHE_FRACTION,
  maxPurchases = DEFAULT_MAX_PURCHASES,
  priceField = "close",
} = {}) {
  const normalizedInitialDrawdown = rate(initialDrawdown, "initialDrawdown", { allowZero: true });
  const normalizedDrawdownStep = rate(drawdownStep, "drawdownStep");
  const normalizedTrancheFraction = rate(trancheFraction, "trancheFraction");
  const normalizedMaxPurchases = normalizeMaxPurchases(maxPurchases);
  const normalizedPriceField = normalizePriceField(priceField);
  if (normalizedTrancheFraction * normalizedMaxPurchases > 1 + 1e-12) {
    throw new TypeError("trancheFraction * maxPurchases must not exceed 1.");
  }

  const rows = normalizeBars(bars, normalizedPriceField);
  const signals = [];
  let peak = null;
  let anchor = null;

  for (const row of rows) {
    if (signals.length >= normalizedMaxPurchases) break;

    if (signals.length === 0) {
      if (!peak || row.price > peak.price) peak = row;
      const triggerPrice = peak.price * (1 - normalizedInitialDrawdown);
      if (!thresholdReached(row.price, triggerPrice)) continue;
      signals.push(Object.freeze({
        index: 1,
        type: "initial_entry",
        date: row.date,
        price: row.price,
        referenceDate: peak.date,
        referencePrice: peak.price,
        triggerPrice,
        drawdownFromReference: drawdown(peak.price, row.price),
        allocationFraction: normalizedTrancheFraction,
      }));
      anchor = row;
      continue;
    }

    const triggerPrice = anchor.price * (1 - normalizedDrawdownStep);
    if (!thresholdReached(row.price, triggerPrice)) continue;
    signals.push(Object.freeze({
      index: signals.length + 1,
      type: "drawdown_step",
      date: row.date,
      price: row.price,
      referenceDate: anchor.date,
      referencePrice: anchor.price,
      triggerPrice,
      drawdownFromReference: drawdown(anchor.price, row.price),
      allocationFraction: normalizedTrancheFraction,
    }));
    anchor = row;
  }

  return Object.freeze({
    signals: Object.freeze(signals),
    summary: Object.freeze({
      signalCount: signals.length,
      requestedAllocationFraction: signals.length * normalizedTrancheFraction,
      remainingAllocationFraction: Math.max(0, 1 - signals.length * normalizedTrancheFraction),
      firstSignalDate: signals[0]?.date ?? null,
      lastSignalDate: signals.at(-1)?.date ?? null,
    }),
    config: Object.freeze({
      initialDrawdown: normalizedInitialDrawdown,
      drawdownStep: normalizedDrawdownStep,
      trancheFraction: normalizedTrancheFraction,
      maxPurchases: normalizedMaxPurchases,
      priceField: normalizedPriceField,
    }),
  });
}

module.exports = {
  DEFAULT_DRAWDOWN_STEP,
  DEFAULT_INITIAL_DRAWDOWN,
  DEFAULT_MAX_PURCHASES,
  DEFAULT_TRANCHE_FRACTION,
  PRICE_FIELDS,
  buildDrawdownBuyingPlan,
  normalizeBars,
  normalizeMaxPurchases,
  normalizePriceField,
  thresholdReached,
};
