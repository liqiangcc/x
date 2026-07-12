"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { securityKey } = require("../src/simulator");

const fixturePath = path.join(__dirname, "fixtures", "simulator", "market.json");
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

test("simulator fixture has a stable ordered calendar and MVP rules", () => {
  assert.deepEqual([...fixture.calendar].sort(), fixture.calendar);
  assert.equal(new Set(fixture.calendar).size, fixture.calendar.length);
  assert.equal(fixture.dataMode, "legacy_approximate");
  assert.equal(fixture.rules.initialCashYuan, 100000);
  assert.equal(fixture.rules.lotSize, 100);
  assert.equal(fixture.rules.tPlusOne, true);
});

test("simulator fixture covers Shanghai Shenzhen and Beijing states", () => {
  const boards = new Set(fixture.securities.map((security) => security.board));
  const statuses = new Set(fixture.securities.map((security) => security.status));
  assert.deepEqual(boards, new Set(["main", "beijing"]));
  assert.equal(statuses.has("st"), true);
  assert.equal(fixture.securities.some((security) => security.delistedDate), true);
  assert.equal(fixture.securities.some((security) => security.code.startsWith("92")), true);
});

test("default candidate fixture contains four strictly declining years", () => {
  for (const key of fixture.expected.defaultCandidates) {
    const yearly = fixture.yearly[key];
    assert.equal(yearly.length, 4);
    assert.equal(
      yearly.slice(1).every((bar, index) => bar.close < yearly[index].close),
      true,
      key
    );
  }
});

test("first breakout and repeated breakout cases are distinct", () => {
  const candidate = fixture.daily["1.600001"];
  const baseline = fixture.yearly["1.600001"].at(-1).high;
  const beforeToday = candidate.filter((bar) => bar.date < fixture.asOfDate);
  const today = candidate.find((bar) => bar.date === fixture.asOfDate);
  assert.equal(Math.max(...beforeToday.map((bar) => bar.close)) <= baseline, true);
  assert.equal(today.close > baseline, true);

  const repeated = fixture.daily["1.600004"];
  const repeatedBaseline = fixture.yearly["1.600004"].at(-1).high;
  assert.equal(
    repeated.some((bar) => bar.date < fixture.asOfDate && bar.close > repeatedBaseline),
    true
  );
});

test("next open fixture covers tradable suspended and limit-up outcomes", () => {
  const byKey = Object.fromEntries(
    fixture.securities.map((security) => [securityKey(security), security])
  );
  for (const key of fixture.expected.tradableAtNextOpen) {
    const bar = fixture.daily[key].find((row) => row.date === fixture.nextTradingDate);
    assert.equal(Number.isFinite(bar.open) && bar.open > 0, true);
    assert.equal(bar.suspended === true, false);
    assert.equal(bar.limitUp === true, false);
    assert.ok(byKey[key]);
  }
  for (const key of fixture.expected.suspendedAtNextOpen) {
    const bar = fixture.daily[key].find((row) => row.date === fixture.nextTradingDate);
    assert.equal(bar.suspended, true);
  }
  for (const key of fixture.expected.limitUpAtNextOpen) {
    const bar = fixture.daily[key].find((row) => row.date === fixture.nextTradingDate);
    assert.equal(bar.open, bar.high);
    assert.equal(bar.high, bar.low);
    assert.equal(bar.limitUp, true);
  }
});

test("fixture defines expected T plus one availability", () => {
  assert.equal(fixture.expected.firstBuyQuantity, 100);
  assert.equal(fixture.expected.firstBuyAvailableSameDay, 0);
  assert.equal(fixture.expected.firstBuyAvailableNextDay, 100);
});
