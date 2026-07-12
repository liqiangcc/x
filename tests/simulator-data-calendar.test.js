"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  LegacyTradingCalendar,
} = require("../src/simulator/data/legacy_trading_calendar");

test("legacy calendar normalizes orders and deduplicates dates", () => {
  const calendar = new LegacyTradingCalendar({
    dates: ["20260703", "2026-07-01", "2026-07-01", "20260702"],
  });
  assert.deepEqual(calendar.dates, ["2026-07-01", "2026-07-02", "2026-07-03"]);
  assert.equal(calendar.has("20260702"), true);
  assert.equal(calendar.next("20260702"), "2026-07-03");
  assert.equal(calendar.previous("20260702"), "2026-07-01");
  assert.equal(calendar.next("2026-06-30"), "2026-07-01");
  assert.equal(calendar.previous("2026-07-04"), "2026-07-03");
  assert.deepEqual(calendar.qualityIssues, ["trading_calendar_approximation"]);
});

test("legacy calendar selects inclusive date ranges", () => {
  const calendar = new LegacyTradingCalendar({
    dates: ["2026-06-30", "2026-07-01", "2026-07-02", "2026-07-03"],
  });
  assert.deepEqual(calendar.between("20260701", "20260702"), ["2026-07-01", "2026-07-02"]);
  assert.throws(() => calendar.between("20260702", "20260701"), /endDate/);
});

test("legacy calendar unions market dates and ignores single-stock suspensions", async () => {
  const rows = new Map([
    ["1.600001", ["2026-06-30", "2026-07-01", "2026-07-03"]],
    ["0.000002", ["2026-06-30", "2026-07-01", "2026-07-02", "2026-07-03"]],
  ]);
  const repository = {
    async getLegacyHistory({ code, market }) {
      return { bars: (rows.get(`${market}.${code}`) ?? []).map((date) => ({ date })) };
    },
  };
  const calendar = await LegacyTradingCalendar.fromRepository({
    marketDataRepository: repository,
    securities: [
      { code: "600001", market: 1 },
      { code: "000002", market: 0 },
    ],
    startDate: "2026-07-01",
    endDate: "2026-07-03",
  });
  assert.deepEqual(calendar.dates, ["2026-07-01", "2026-07-02", "2026-07-03"]);
  assert.equal(calendar.sourceSecurities, 2);
  assert.equal(calendar.next("2026-07-01"), "2026-07-02");
});

test("legacy calendar keeps long holidays absent", async () => {
  const repository = {
    async getLegacyHistory() {
      return { bars: [{ date: "2026-09-30" }, { date: "2026-10-09" }] };
    },
  };
  const calendar = await LegacyTradingCalendar.fromRepository({
    marketDataRepository: repository,
    securities: [{ code: "600001", market: 1 }],
    endDate: "20261009",
  });
  assert.equal(calendar.next("2026-09-30"), "2026-10-09");
  assert.deepEqual(calendar.between("20261001", "20261008"), []);
});

test("legacy calendar validates repository and dates", async () => {
  await assert.rejects(
    () => LegacyTradingCalendar.fromRepository({ marketDataRepository: {}, securities: [], endDate: "20260701" }),
    /getLegacyHistory/
  );
  assert.throws(() => new LegacyTradingCalendar({ dates: ["bad"] }), /date/);
});
