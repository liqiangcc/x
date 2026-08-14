"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  assertBars,
  calculateMarketSummary,
  priceExtreme,
} = require("../src/analytics/market/market_summary_calculator");

function bar(date, { open, close, high, low }) {
  return { date, open, close, high, low };
}

test("market summary calculator derives latest, return, extremes, and coverage deterministically", () => {
  const result = calculateMarketSummary([
    bar("2026-01-02", { open: 98, close: 100, high: 102, low: 97 }),
    bar("2026-01-05", { open: 119, close: 120, high: 125, low: 118 }),
    bar("2026-01-06", { open: 91, close: 90, high: 92, low: 85 }),
    bar("2026-01-07", { open: 108, close: 110, high: 113, low: 107 }),
  ]);

  assert.deepEqual(result.latest, { date: "2026-01-07", close: 110 });
  assert.deepEqual(result.range, {
    firstDate: "2026-01-02",
    lastDate: "2026-01-07",
    firstClose: 100,
    lastClose: 110,
    returnRate: 0.10000000000000009,
    high: { date: "2026-01-05", price: 125 },
    low: { date: "2026-01-06", price: 85 },
  });
  assert.deepEqual(result.coverage, {
    barCount: 4,
    observedStartDate: "2026-01-02",
    observedEndDate: "2026-01-07",
  });
});

test("market summary calculator represents empty or incomplete data without inventing values", () => {
  assert.deepEqual(calculateMarketSummary([]), {
    latest: null,
    range: {
      firstDate: null,
      lastDate: null,
      firstClose: null,
      lastClose: null,
      returnRate: null,
      high: null,
      low: null,
    },
    coverage: {
      barCount: 0,
      observedStartDate: null,
      observedEndDate: null,
    },
  });

  const incomplete = calculateMarketSummary([
    { date: "2026-01-02", close: null, high: null, low: null },
    { date: "2026-01-03", close: 10, high: 11, low: 9 },
  ]);
  assert.deepEqual(incomplete.latest, { date: "2026-01-03", close: 10 });
  assert.equal(incomplete.range.firstDate, "2026-01-03");
  assert.equal(incomplete.range.returnRate, 0);
});

test("market summary calculator helpers reject invalid collection ownership", () => {
  assert.equal(assertBars([]).length, 0);
  assert.throws(() => assertBars(null), /bars must be an array/);
  assert.deepEqual(
    priceExtreme([{ date: "2026-01-01", high: 10 }, { date: "2026-01-02", high: 12 }], "high", (a, b) => a > b),
    { date: "2026-01-02", price: 12 }
  );
});
