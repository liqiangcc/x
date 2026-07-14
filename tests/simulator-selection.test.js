"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  calculateBollSeries,
  calculateBollWindow,
} = require("../src/signals/indicators/boll");
const { dailyChartWindow, justCrossedBollMiddle, positionCycleOpenDates, prioritizeHeldWatchlist, yearlyChartWindow } = require("../src/simulator/application/runtime_service");
const {
  evaluateYearDeclineCloseBreakout,
} = require("../src/signals/signals/year_decline_close_breakout");
const {
  HistoricalUniverse,
} = require("../src/simulator/selection/historical_universe");
const {
  applyMarketScope,
  CandidateSelectionPipeline,
  paginate,
} = require("../src/simulator/selection/pipeline");

test("strategy market scope filters boards before reading K-line history", () => {
  const universe = { securities: [
    { code: "600001", market: 1 },
    { code: "300001", market: 0 },
    { code: "688001", market: 1 },
    { code: "920001", market: 0 },
  ] };
  const scoped = applyMarketScope(universe, { universe: {
    beijingExchange: false, chiNext: true, mainBoard: true, starMarket: false,
  } });
  assert.deepEqual(scoped.securities.map((item) => item.code), ["600001", "300001"]);
});

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

test("detail chart warms BOLL with 19 hidden bars and returns 20 visible bars", () => {
  const bars = Array.from({ length: 45 }, (_item, index) => ({
    close: index + 1,
    date: `d${index + 1}`,
    high: index + 1,
    low: index + 1,
    open: index + 1,
  }));
  const visible = dailyChartWindow(bars, "d30");
  assert.equal(visible.length, 20);
  assert.equal(visible[0].date, "d26");
  assert.equal(visible[0].bollMiddle, 16.5);
  assert.equal(visible.filter((bar) => bar.signal).length, 1);
});

test("detail chart can return a larger navigable window while preserving 20-day BOLL", () => {
  const bars = Array.from({ length: 300 }, (_item, index) => ({ close: index + 1, date: `d${index + 1}`, high: index + 1, low: index + 1, open: index + 1 }));
  const visible = dailyChartWindow(bars, null, 240);
  assert.equal(visible.length, 240);
  assert.equal(visible[0].date, "d61");
  assert.equal(visible[0].bollMiddle, 51.5);
});

test("detail chart aggregates the current year only from daily bars available by the simulated date", () => {
  const yearly = yearlyChartWindow([
    { close: 9, date: "2025-12-31", high: 11, low: 7, open: 10, volume: 100, amount: 900 },
    { close: 99, date: "2026-07-13", high: 100, low: 1, open: 9, volume: 999, amount: 9999 },
  ], [
    { amount: 1000, close: 10, date: "2026-01-05", high: 11, low: 8, open: 9, volume: 100 },
    { amount: 1500, close: 12, date: "2026-03-02", high: 13, low: 9, open: 10, volume: 150 },
  ], "2026-03-02");
  assert.deepEqual(yearly, [
    { close: 9, date: "2025-12-31", high: 11, low: 7, open: 10, volume: 100, amount: 900, year: 2025 },
    { amount: 2500, close: 12, high: 13, low: 8, open: 9, volume: 250, year: 2026 },
  ]);
});

test("watchlist BOLL cross requires yesterday at or below and today above the middle line", () => {
  assert.equal(justCrossedBollMiddle({ bollMiddle: 10, close: 10 }, { bollMiddle: 10.5, close: 11 }), true);
  assert.equal(justCrossedBollMiddle({ bollMiddle: 10, close: 10.1 }, { bollMiddle: 10.5, close: 11 }), false);
  assert.equal(justCrossedBollMiddle({ bollMiddle: null, close: 9 }, { bollMiddle: 10, close: 11 }), null);
});

test("position holding cycle starts on first buy and resets only after a full exit", () => {
  const security = { code: "600001", market: 1 };
  const orders = new Map([
    ["buy-1", { id: "buy-1", security }],
    ["buy-2", { id: "buy-2", security }],
    ["sell-1", { id: "sell-1", security }],
    ["sell-2", { id: "sell-2", security }],
    ["buy-3", { id: "buy-3", security }],
  ]);
  const fills = [
    { date: "2026-07-01", orderId: "buy-1", quantity: 100, side: "buy" },
    { date: "2026-07-02", orderId: "buy-2", quantity: 100, side: "buy" },
    { date: "2026-07-03", orderId: "sell-1", quantity: 100, side: "sell" },
    { date: "2026-07-06", orderId: "sell-2", quantity: 100, side: "sell" },
    { date: "2026-07-07", orderId: "buy-3", quantity: 100, side: "buy" },
  ];
  assert.equal(positionCycleOpenDates({ fills: fills.slice(0, 3), orders }).get("1.600001"), "2026-07-01");
  assert.equal(positionCycleOpenDates({ fills, orders }).get("1.600001"), "2026-07-07");
});

test("watchlist sorts held stocks by return and keeps unavailable returns stable at the end", () => {
  const items = [
    { candidateId: "a", detail: { holding: null } },
    { candidateId: "b", detail: { holding: { quantity: 100, unrealizedPnlPct: -5 } } },
    { candidateId: "c", detail: { holding: null } },
    { candidateId: "d", detail: { holding: { quantity: 200, unrealizedPnlPct: 10 } } },
  ];
  assert.deepEqual(prioritizeHeldWatchlist(items).map((item) => item.candidateId), ["d", "b", "a", "c"]);
});

test("default composite candidate requires three consecutive annual close declines", () => {
  const result = evaluateYearDeclineCloseBreakout(candidateContext());
  assert.equal(result.ok, true);
  assert.deepEqual(result.evidence.annual_points.map((point) => point.year), [2022, 2023, 2024, 2025]);
  assert.equal(result.evidence.previous_year_high, 17);
  assert.equal(result.evidence.max_previous_current_year_close, 16.8);
  assert.ok(result.evidence.breakout_margin_pct > 1.17);
  assert.ok(Math.abs(result.evidence.today_change_pct - ((17.2 - 16.8) / 16.8) * 100) < 1e-10);

  assert.equal(evaluateYearDeclineCloseBreakout(candidateContext({
    closes: [20, 18, 19, 14],
  })).ok, false);
});

test("decline transitions parameter determines the required complete years", () => {
  const twoTransitions = evaluateYearDeclineCloseBreakout(candidateContext(), { downTransitions: 2 });
  assert.equal(twoTransitions.ok, true);
  assert.equal(twoTransitions.evidence.required_complete_years, 3);
  assert.equal(twoTransitions.evidence.down_transitions, 2);
  assert.deepEqual(twoTransitions.evidence.annual_points.map((point) => point.year), [2023, 2024, 2025]);
  assert.throws(() => evaluateYearDeclineCloseBreakout(candidateContext(), { downTransitions: 0 }), /downTransitions/);
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

test("selection pipeline prepares every trading date with one bounded history pass", async () => {
  let historyReads = 0;
  const bars = new Map([["600001", repositoryBars(2)]]);
  const pipeline = new CandidateSelectionPipeline({
    historicalUniverse: new HistoricalUniverse({
      repository: { async listAvailableCodes() {
        return { qualityIssues: [], securities: [{ code: "600001", market: 1, status: "normal" }], source: "fixture" };
      } },
    }),
    klineRepository: { async getLegacyHistory({ code, period }) {
      historyReads += 1;
      return { bars: bars.get(code)[period], qualityIssues: [] };
    } },
  });
  await pipeline.prepare({ dates: ["2026-06-30", "2026-07-01"], dataVersion: "prepared-v1" });
  assert.equal(historyReads, 2);
  const result = await pipeline.select({ asOfDate: "2026-07-01", dataVersion: "prepared-v1" });
  assert.equal(result.pagination.total, 1);
  assert.equal(historyReads, 2);
});

test("full strategy index finds the same first-breakout occurrence in one history pass", async () => {
  let reads = 0;
  const bars = new Map([["600001", repositoryBars(2)]]);
  const pipeline = new CandidateSelectionPipeline({
    historicalUniverse: new HistoricalUniverse({ repository: { async listAvailableCodes() {
      return { qualityIssues: [], securities: [{ code: "600001", market: 1, status: "normal" }], source: "fixture" };
    } } }),
    klineRepository: { async getLegacyHistory({ code, period }) {
      reads += 1;
      return { bars: bars.get(code)[period], qualityIssues: [] };
    } },
  });
  const index = await pipeline.buildAll({ dataVersion: "index-v1" });
  assert.equal(reads, 2);
  assert.equal(index.signalCount, 1);
  assert.equal(index.byDate.get("2026-07-01")[0].code, "600001");
});

test("strategy index can rebuild only explicitly changed securities", async () => {
  const reads = [];
  const bars = new Map([["600001", repositoryBars(2)], ["600002", repositoryBars(2)]]);
  const pipeline = new CandidateSelectionPipeline({
    historicalUniverse: new HistoricalUniverse({ repository: { async listAvailableCodes() {
      return { qualityIssues: [], securities: [
        { code: "600001", market: 1, status: "normal" },
        { code: "600002", market: 1, status: "normal" },
      ], source: "fixture" };
    } } }),
    klineRepository: { async getLegacyHistory({ code, period }) {
      reads.push(`${code}:${period}`);
      return { bars: bars.get(code)[period], qualityIssues: [] };
    } },
  });
  const index = await pipeline.buildAll({ dataVersion: "index-v1", securityCodes: ["600002"] });
  assert.deepEqual(reads, ["600002:yearly", "600002:daily"]);
  assert.equal(index.byDate.get("2026-07-01")[0].code, "600002");
});

test("candidate pagination defaults to 20 and validates input", () => {
  const candidates = Array.from({ length: 25 }, (_, index) => ({ index }));
  assert.equal(paginate(candidates).items.length, 20);
  assert.equal(paginate(candidates, { page: 2 }).items.length, 5);
  assert.equal(paginate(candidates, { viewAll: true }).items.length, 25);
  assert.throws(() => paginate(candidates, { page: 0 }), /page/);
});
