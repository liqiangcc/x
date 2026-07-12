"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  calculateBollSeries,
  calculateBollWindow,
} = require("../src/signals/indicators/boll");

test("BOLL series aligns dates and leaves warmup points empty", () => {
  const rows = [1, 2, 3, 4].map((close, index) => ({
    date: `2026-07-0${index + 1}`,
    close,
  }));
  const series = calculateBollSeries(rows, { period: 3, multiplier: 2 });
  assert.deepEqual(series.slice(0, 2), [
    { date: "2026-07-01", lower: null, middle: null, stddev: null, upper: null },
    { date: "2026-07-02", lower: null, middle: null, stddev: null, upper: null },
  ]);
  assert.equal(series[2].middle, 2);
  assert.equal(series[3].middle, 3);
  assert.ok(series[2].lower < series[2].middle);
  assert.ok(series[2].upper > series[2].middle);
});

test("BOLL defaults to population standard deviation", () => {
  const point = calculateBollWindow([1, 2, 3], { multiplier: 2 });
  assert.equal(point.middle, 2);
  assert.equal(point.stddev, Math.sqrt(2 / 3));
  assert.equal(point.upper, 2 + 2 * Math.sqrt(2 / 3));
  assert.equal(point.lower, 2 - 2 * Math.sqrt(2 / 3));
});

test("BOLL supports sample deviation and custom fields", () => {
  const series = calculateBollSeries([
    { date: "2026-07-01", value: 2 },
    { date: "2026-07-02", value: 4 },
  ], { field: "value", period: 2, multiplier: 1, stddevMode: "sample" });
  assert.equal(series[1].middle, 3);
  assert.equal(series[1].stddev, Math.sqrt(2));
});

test("BOLL validates configuration and keeps invalid windows empty", () => {
  assert.throws(() => calculateBollSeries([], { period: 0 }), /period/);
  assert.throws(() => calculateBollWindow([1], { stddevMode: "sample" }), /at least two/);
  assert.throws(() => calculateBollWindow([1, Number.NaN]), /finite/);
  const series = calculateBollSeries([
    { date: "2026-07-01", close: 1 },
    { date: "2026-07-02", close: null },
  ], { period: 2 });
  assert.equal(series[1].middle, null);
});
