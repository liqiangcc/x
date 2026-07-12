"use strict";

const STDDEV_MODES = new Set(["population", "sample"]);

function calculateBollWindow(values, { multiplier = 2, stddevMode = "population" } = {}) {
  if (!Array.isArray(values) || values.length === 0 || values.some((value) => !Number.isFinite(value))) {
    throw new TypeError("BOLL values must be a non-empty finite number array.");
  }
  if (!Number.isFinite(multiplier) || multiplier < 0) {
    throw new TypeError("BOLL multiplier must be a non-negative number.");
  }
  if (!STDDEV_MODES.has(stddevMode)) {
    throw new TypeError("BOLL stddevMode must be population or sample.");
  }
  const denominator = stddevMode === "sample" ? values.length - 1 : values.length;
  if (denominator <= 0) {
    throw new TypeError("BOLL sample standard deviation requires at least two values.");
  }
  const middle = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - middle) ** 2, 0) / denominator;
  const stddev = Math.sqrt(variance);
  return {
    lower: middle - multiplier * stddev,
    middle,
    stddev,
    upper: middle + multiplier * stddev,
  };
}

function calculateBollSeries(rows, {
  field = "close",
  period = 20,
  multiplier = 2,
  stddevMode = "population",
} = {}) {
  if (!Array.isArray(rows)) throw new TypeError("BOLL rows must be an array.");
  if (!Number.isInteger(period) || period < 1) {
    throw new TypeError("BOLL period must be a positive integer.");
  }
  return rows.map((row, index) => {
    const base = { date: row?.date ?? null, lower: null, middle: null, stddev: null, upper: null };
    if (index < period - 1) return base;
    const values = rows.slice(index - period + 1, index + 1).map((item) => item?.[field]);
    if (values.some((value) => !Number.isFinite(value))) return base;
    return {
      date: base.date,
      ...calculateBollWindow(values, { multiplier, stddevMode }),
    };
  });
}

module.exports = {
  STDDEV_MODES,
  calculateBollSeries,
  calculateBollWindow,
};
