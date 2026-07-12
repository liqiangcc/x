"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  calculateBollSeries,
  calculateBollWindow,
} = require("../src/signals/indicators/boll");
const {
  evaluateYearDeclineCloseBreakout,
} = require("../src/signals/signals/year_decline_close_breakout");
const {
  HistoricalUniverse,
} = require("../src/simulator/selection/historical_universe");
const {
  CandidateSelectionPipeline,
  paginate,
} = require("../src/simulator/selection/pipeline");

function candidateContext({
  closes = [20, 18, 16, 14],
  currentCloses = [14.5, 16.4, 16.8, 17.2],
  previousYearHigh = 17,
} = {}) {
  const annualPoints = closes.map((close, index) => ({
    close,
    high: index === closes.length - 1 ? previousYearHigh : close + 4,
    year: 2022 + index,
  }));
  const dates = ["2026-01-02", "2026-06-29", "2026-06-30", "2026-07-01"];
  const dailyRows = currentCloses.map((close, index) => ({ close, date: dates[index] }));
  return {
    dailyRows,
    features: {
      completedYears: annualPoints,
      today: dailyRows.at(-1),
    },
    isoDate: "2026-07-01",
  };
}

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

test("default composite candidate requires four consecutive declining complete years", () => {
  const result = evaluateYearDeclineCloseBreakout(candidateContext());
  assert.equal(result.ok, true);
  assert.deepEqual(result.evidence.annual_points.map((point) => point.year), [2022, 2023, 2024, 2025]);
  assert.equal(result.evidence.previous_year_high, 17);
  assert.equal(result.evidence.max_previous_current_year_close, 16.8);
  assert.ok(result.evidence.breakout_margin_pct > 1.17);

  assert.equal(evaluateYearDeclineCloseBreakout(candidateContext({
    closes: [20, 18, 19, 14],
  })).ok, false);
});

test("default composite candidate reports a quality failure for a missing natural year", () => {
  const context = candidateContext();
  context.features.completedYears.splice(1, 1);
  const result = evaluateYearDeclineCloseBreakout(context);
  assert.equal(result.ok, false);
  assert.deepEqual(result.qualityIssues, ["insufficient_consecutive_complete_years"]);
});

test("default composite candidate checks every earlier current-year close", () => {
  const repeated = evaluateYearDeclineCloseBreakout(candidateContext({
    currentCloses: [17.1, 16.4, 16.8, 17.2],
  }));
  assert.equal(repeated.ok, false);
  assert.equal(repeated.evidence.max_previous_current_year_close, 17.1);

  const touchesOnly = evaluateYearDeclineCloseBreakout(candidateContext({
    currentCloses: [17, 16.4, 16.8, 17.2],
  }));
  assert.equal(touchesOnly.ok, true);
});

test("default composite candidate never reads closes after the simulated date", () => {
  const context = candidateContext();
  context.dailyRows.push({ close: 99, date: "2026-07-02" });
  assert.equal(evaluateYearDeclineCloseBreakout(context).ok, true);
});

function repositoryBars(margin, { repeated = false } = {}) {
  const previousYearHigh = 17;
  return {
    daily: [
      { close: repeated ? 17.1 : 16.5, date: "2026-01-02" },
      { close: previousYearHigh * (1 + margin / 100), date: "2026-07-01" },
    ],
    yearly: [20, 18, 16, 14].map((close, index) => ({
      close,
      date: `${2022 + index}-12-31`,
      high: index === 3 ? previousYearHigh : close + 4,
    })),
  };
}

test("historical universe excludes reliable ST statuses and records missing status metadata", async () => {
  const historicalUniverse = new HistoricalUniverse({
    repository: {
      async listAvailableCodes() {
        return {
          qualityIssues: ["historical_universe_unavailable"],
          securities: [
            { code: "600001", market: 1, status: "normal" },
            { code: "000002", market: 0, status: "*ST" },
            { code: "600003", market: 1 },
          ],
          source: "fixture",
        };
      },
    },
  });
  const result = await historicalUniverse.list({ asOfDate: "20260701" });
  assert.deepEqual(result.securities.map((item) => item.code), ["600001", "600003"]);
  assert.equal(result.excluded.length, 1);
  assert.equal(result.qualityIssues.includes("security_status_unavailable"), true);
});

test("selection pipeline filters, sorts, paginates and reuses a versioned snapshot", async () => {
  let historyReads = 0;
  const bars = new Map([
    ["600001", repositoryBars(2)],
    ["600002", repositoryBars(1)],
    ["600003", repositoryBars(3, { repeated: true })],
  ]);
  const pipeline = new CandidateSelectionPipeline({
    historicalUniverse: new HistoricalUniverse({
      repository: {
        async listAvailableCodes() {
          return {
            qualityIssues: [],
            securities: [...bars.keys()].map((code) => ({ code, market: 1, status: "normal" })),
            source: "fixture",
          };
        },
      },
    }),
    klineRepository: {
      async getLegacyHistory({ code, period }) {
        historyReads += 1;
        return { bars: bars.get(code)[period], qualityIssues: [] };
      },
    },
  });

  const first = await pipeline.select({ asOfDate: "20260701", dataVersion: "fixture-v1", pageSize: 1 });
  assert.equal(first.pagination.total, 2);
  assert.deepEqual(first.pagination.items.map((item) => item.code), ["600002"]);
  assert.equal(first.pagination.totalPages, 2);
  assert.equal(historyReads, 6);

  const cached = await pipeline.select({ asOfDate: "20260701", dataVersion: "fixture-v1", viewAll: true });
  assert.deepEqual(cached.pagination.items.map((item) => item.code), ["600002", "600001"]);
  assert.equal(historyReads, 6);

  await pipeline.select({ asOfDate: "20260701", dataVersion: "fixture-v2" });
  assert.equal(historyReads, 12);
});

test("candidate pagination defaults to 20 and validates input", () => {
  const candidates = Array.from({ length: 25 }, (_, index) => ({ index }));
  assert.equal(paginate(candidates).items.length, 20);
  assert.equal(paginate(candidates, { page: 2 }).items.length, 5);
  assert.equal(paginate(candidates, { viewAll: true }).items.length, 25);
  assert.throws(() => paginate(candidates, { page: 0 }), /page/);
});
