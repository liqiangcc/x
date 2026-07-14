"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { deriveLimitState, normalLimitRate } = require("../src/signals/limit_state");

test("limit policy is board- and date-aware for normal A shares", () => {
  assert.equal(normalLimitRate({ date: "2020-08-21", security: { code: "300001" } }).ratePct, 10);
  assert.equal(normalLimitRate({ date: "2020-08-24", security: { code: "300001" } }).ratePct, 20);
  assert.equal(normalLimitRate({ date: "2026-07-01", security: { code: "688001" } }).ratePct, 20);
  assert.equal(normalLimitRate({ date: "2026-07-01", security: { code: "830001" } }).ratePct, 30);
  assert.equal(normalLimitRate({ date: "2026-07-01", security: { code: "600001" } }).ratePct, 10);
});

test("limit state distinguishes close limit-up, touch, broken board, and one-price board", () => {
  const previousBar = { close: 10, date: "2026-06-30" };
  const closed = deriveLimitState({ bar: { changePct: 10, close: 11, date: "2026-07-01", high: 11, low: 10.5, open: 10.6 }, previousBar, security: { code: "600001" } });
  assert.equal(closed.isLimitUp, true);
  assert.equal(closed.touchedLimitUp, true);
  assert.equal(closed.brokenLimitUp, false);
  assert.equal(closed.calculationSource, "reported_change_pct");

  const broken = deriveLimitState({ bar: { changePct: 5, close: 10.5, date: "2026-07-01", high: 11, low: 10.4, open: 10.6 }, previousBar, security: { code: "600001" } });
  assert.equal(broken.isLimitUp, false);
  assert.equal(broken.brokenLimitUp, true);

  const onePrice = deriveLimitState({ bar: { changePct: 10, close: 11, date: "2026-07-01", high: 11, low: 11, open: 11 }, previousBar, security: { code: "600001" } });
  assert.equal(onePrice.isOnePriceLimitUp, true);
});
