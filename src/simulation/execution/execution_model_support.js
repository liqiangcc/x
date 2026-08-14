"use strict";

function positiveMoney(value, field) {
  if (!Number.isFinite(value) || value <= 0) throw new TypeError(`${field} must be positive.`);
  return value;
}

function nonNegativeMoney(value, field) {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${field} must be non-negative.`);
  return value;
}

function normalizeExecutionBars(bars) {
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

function resolveNextExecutionBar(bars, signalDate) {
  if (!Array.isArray(bars)) throw new TypeError("bars must be an array.");
  const normalizedSignalDate = String(signalDate ?? "");
  const signalIndex = bars.findIndex(
    (bar) => String(bar?.date ?? "") === normalizedSignalDate
  );
  if (signalIndex < 0) {
    throw new TypeError(`No Kline bar is available for signal date ${normalizedSignalDate}.`);
  }
  const executionIndex = signalIndex + 1;
  return Object.freeze({
    signalDate: normalizedSignalDate,
    signalIndex,
    executionIndex,
    bar: bars[executionIndex] ?? null,
  });
}

function skippedBuyExecutionResult({
  status,
  reason,
  signalDate,
  executionDate = null,
  requestedBudget,
  effectiveBudget,
}) {
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

module.exports = {
  nonNegativeMoney,
  normalizeExecutionBars,
  positiveMoney,
  resolveNextExecutionBar,
  skippedBuyExecutionResult,
};
