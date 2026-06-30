"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  normalizeDate,
  calculateInclusiveDays,
  formatDateInTimeZone,
  formatMarketDate,
} = require("../src/core/date");
const { parseJsonOrJsonp, stripJsonp } = require("../src/core/jsonp");
const { inferSecid, splitSecid } = require("../src/core/secid");

test("normalizeDate accepts compact and dashed dates", () => {
  assert.equal(normalizeDate("20260325"), "20260325");
  assert.equal(normalizeDate("2026-03-25"), "20260325");
});

test("normalizeDate rejects impossible calendar dates", () => {
  assert.throws(() => normalizeDate("20260230"), /Invalid calendar date/);
  assert.throws(() => normalizeDate("2026/03/25"), /Invalid date format/);
});

test("calculateInclusiveDays counts both endpoints", () => {
  assert.equal(calculateInclusiveDays("20260325", "20260325"), 1);
  assert.equal(calculateInclusiveDays("20260325", "20260327"), 3);
});

test("market date formatting uses Asia Shanghai calendar days", () => {
  const lateUtc = new Date("2026-06-29T16:30:00.000Z");
  assert.equal(formatDateInTimeZone(lateUtc, "UTC"), "20260629");
  assert.equal(formatMarketDate(0, lateUtc), "20260630");
  assert.equal(formatMarketDate(-1, lateUtc), "20260629");
});

test("JSONP parser strips callback wrappers and parses direct JSON", () => {
  assert.equal(stripJsonp("cb({\"ok\":true});"), "{\"ok\":true}");
  assert.deepEqual(parseJsonOrJsonp("cb({\"ok\":true});"), { ok: true });
  assert.deepEqual(parseJsonOrJsonp("{\"ok\":true}"), { ok: true });
});

test("secid inference handles Shanghai and Shenzhen style codes", () => {
  assert.equal(inferSecid("600519"), "1.600519");
  assert.equal(inferSecid("000020"), "0.000020");
  assert.equal(inferSecid("300001"), "0.300001");
  assert.deepEqual(splitSecid("1.600519"), { market: 1, code: "600519", secid: "1.600519" });
});
