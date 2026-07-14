"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  STRATEGY_BUILDER_CATALOG,
  compileStrategy,
  defaultCompositeStrategy,
  normalizeCompositeStrategy,
  toV3Definition,
} = require("../src/strategies/strategy_builder");

function context({ earlierBreakout = false, todayClose = 17.2 } = {}) {
  const completedYears = [20, 18, 16, 14].map((close, index) => ({ close, high: index === 3 ? 17 : close + 2, year: 2022 + index }));
  const dailyRows = [
    { close: earlierBreakout ? 17.1 : 15, date: "2026-01-02", high: 17.2, low: 14, open: 14.5, volume: 100 },
    { close: 16.8, date: "2026-06-30", high: 16.9, low: 16, open: 16.2, volume: 120 },
    { close: todayClose, date: "2026-07-01", high: 17.3, low: 16.7, open: 16.8, volume: 150 },
  ];
  return { dailyRows, features: { completedYears, today: dailyRows.at(-1) }, isoDate: "2026-07-01" };
}

test("default V2 template composes a yearly state rule and first-breakout event", () => {
  const compiled = compileStrategy(defaultCompositeStrategy());
  const hit = compiled.evaluate(context());
  assert.equal(hit.ok, true);
  assert.equal(hit.evidence.down_transitions, 3);
  assert.equal(hit.evidence.required_complete_years, 4);
  assert.equal(hit.evidence.rules.length, 2);
  assert.match(compiled.description, /连续3年/);
  assert.equal(compiled.yearlyPrefilter(context().features.completedYears), true);
  assert.equal(compiled.evaluate(context({ earlierBreakout: true })).ok, false);
  assert.equal(compiled.evaluate(context({ todayClose: 16.9 })).ok, false);
});

test("V3 compiles migrated definitions through registries with equivalent signals", () => {
  const v2 = compileStrategy(defaultCompositeStrategy());
  const definition = toV3Definition(defaultCompositeStrategy(), { orderBy: "breakout_margin_ascending" });
  const v3 = compileStrategy(definition);
  for (const input of [context(), context({ earlierBreakout: true }), context({ todayClose: 16.9 })]) {
    assert.equal(v3.evaluate(input).ok, v2.evaluate(input).ok);
  }
  assert.equal(v3.engineVersion, 8);
  assert.equal(v3.definition.composition.operator, "all");
  assert.equal(v3.definition.ranking[0].operand.kind, "ruleOutput");
});

test("V3 catalog exposes parameter schemas and generic emission and ranking mechanisms", () => {
  assert.equal(STRATEGY_BUILDER_CATALOG.schemaVersion, 3);
  assert.equal(STRATEGY_BUILDER_CATALOG.rules.find((item) => item.id === "window_count").paramSchema.lookback.type, "integer");
  const definition = toV3Definition(defaultCompositeStrategy());
  definition.emission.mode = "on_enter";
  const compiled = compileStrategy(definition);
  const state = compiled.createEvaluationState();
  assert.equal(compiled.evaluate(context(), state).ok, true);
  assert.equal(compiled.evaluate(context(), state).ok, false);
  const low = { evidence: { rankingValues: [10] }, securityKey: "1.600001" };
  const high = { evidence: { rankingValues: [20] }, securityKey: "1.600002" };
  assert.equal(compiled.compareCandidates(low, high) < 0, true);
});

test("registered indicators can be referenced by reusable crossing rules", () => {
  const definition = normalizeCompositeStrategy({
    indicators: [{ key: "ma2", params: { field: "close", period: 2 }, type: "moving_average" }],
    rules: [{ key: "close_cross_ma", params: { direction: "up", left: "daily.today.close", right: "indicator.ma2.value" }, type: "cross" }],
    schemaVersion: 2,
    templateId: "custom-template-a",
    type: "capability_composite",
  });
  const rows = [
    { close: 10, date: "2026-01-02" },
    { close: 8, date: "2026-01-05" },
    { close: 12, date: "2026-01-06" },
  ];
  const result = compileStrategy(definition).evaluate({ dailyRows: rows, features: { completedYears: [], today: rows.at(-1) }, isoDate: "2026-01-06" });
  assert.equal(result.ok, true);
  assert.equal(result.evidence.rules[0].type, "cross");
});

test("stateful full-index evaluation matches history scans without rescanning prior days", () => {
  const compiled = compileStrategy(defaultCompositeStrategy());
  const source = context();
  const state = compiled.createEvaluationState();
  source.dailyRows.forEach((today, index) => {
    const dailyRows = source.dailyRows.slice(0, index + 1);
    const current = { dailyRows, features: { ...source.features, currentYearBeforeToday: dailyRows.slice(0, -1), today }, isoDate: today.date };
    const scanned = compiled.evaluate(current);
    const stateful = compiled.evaluate(current, state);
    assert.equal(stateful.ok, scanned.ok);
    assert.equal(stateful.evidence.rules[1].priorMatchCount, scanned.evidence.rules[1].priorMatchCount);
  });
});

test("limit-up boolean, window count, and consecutive rules compose from registered features", () => {
  const rows = [
    { changePct: 0, close: 10, date: "2026-06-29", high: 10.1, low: 9.9, open: 10 },
    { changePct: 10, close: 11, date: "2026-06-30", high: 11, low: 10.5, open: 10.6 },
    { changePct: 10, close: 12.1, date: "2026-07-01", high: 12.1, low: 11.5, open: 11.6 },
  ];
  const definition = normalizeCompositeStrategy({
    indicators: [],
    rules: [
      { key: "closed_limit", params: { expected: true, feature: "daily.today.is_limit_up" }, type: "boolean_feature" },
      { key: "two_in_three", params: { count: 2, feature: "daily.today.is_limit_up", lookback: 3, operator: "eq" }, type: "window_count" },
      { key: "two_consecutive", params: { feature: "daily.today.is_limit_up", minimum: 2 }, type: "consecutive_count" },
    ],
    schemaVersion: 2,
    templateId: "custom_composite",
    type: "capability_composite",
  });
  const result = compileStrategy(definition).evaluate({ dailyRows: rows, features: { completedYears: [], today: rows.at(-1) }, isoDate: "2026-07-01", security: { code: "600001", market: 1 } });
  assert.equal(result.ok, true);
  assert.equal(result.evidence.rules[0].limitState.ratePct, 10);
  assert.equal(result.evidence.rules[1].count, 2);
  assert.equal(result.evidence.rules[2].count, 2);
  assert.equal(result.qualityIssues.includes("legacy_approximate_limit_rules"), true);
});

test("strategy compiler rejects unknown references, duplicate keys, and state-only strategies", () => {
  assert.throws(() => normalizeCompositeStrategy({ indicators: [], rules: [{ key: "state", params: { left: "daily.today.close", operator: "gt", right: "yearly.previous.high" }, type: "value_compare" }], schemaVersion: 2, type: "capability_composite" }), { code: "strategy_event_rule_required" });
  assert.throws(() => normalizeCompositeStrategy({ indicators: [], rules: [{ key: "cross", params: { left: "daily.today.close", right: "indicator.missing.value" }, type: "cross" }], schemaVersion: 2, type: "capability_composite" }), { code: "unknown_strategy_indicator" });
  assert.throws(() => normalizeCompositeStrategy({ indicators: [{ key: "ma", type: "moving_average" }, { key: "ma", type: "moving_average" }], rules: [{ key: "cross", params: { left: "daily.today.close", right: "indicator.ma.value" }, type: "cross" }], schemaVersion: 2, type: "capability_composite" }), { code: "duplicate_strategy_key" });
  assert.throws(() => normalizeCompositeStrategy({ indicators: [{ key: "ma", type: "moving_average" }], rules: [{ key: "first", params: { baseline: "yearly.previous.high", current: "indicator.ma.value", historyField: "close" }, type: "first_occurrence" }], schemaVersion: 2, type: "capability_composite" }), { code: "invalid_strategy_operand" });
  assert.throws(() => normalizeCompositeStrategy({ indicators: [], rules: [{ key: "limit", params: { feature: "daily.today.unknown" }, type: "boolean_feature" }], schemaVersion: 2, type: "capability_composite" }), { code: "invalid_strategy_config" });
});
