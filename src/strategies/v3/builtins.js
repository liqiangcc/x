"use strict";

const { calculateBollWindow } = require("../../signals/indicators/boll");
const { LIMIT_FEATURES, limitFeatureValue } = require("../../signals/limit_state");
const { createCapabilityRegistries } = require("./registry");

const FIELDS = ["amount", "close", "high", "low", "open", "volume"];
const COMPARATORS = ["eq", "gt", "gte", "lt", "lte"];

function average(rows, field, period, offset = 0) {
  const end = rows.length - offset;
  const values = rows.slice(Math.max(0, end - period), end).map((row) => row[field]);
  return values.length === period && values.every(Number.isFinite)
    ? values.reduce((sum, value) => sum + value, 0) / period
    : null;
}

function extreme(rows, field, period, mode, offset = 0) {
  const end = rows.length - offset;
  const values = rows.slice(Math.max(0, end - period), end).map((row) => row[field]);
  if (values.length !== period || values.some((value) => !Number.isFinite(value))) return null;
  return mode === "min" ? Math.min(...values) : Math.max(...values);
}

function registerFeatures(registry) {
  for (const scope of ["daily.today", "daily.previous", "yearly.previous"]) {
    for (const field of FIELDS) {
      const id = `${scope}.${field}`;
      registry.register({
        compute(context, offset = 0) {
          if (scope === "yearly.previous") return context.annualRows.at(-1 - offset)?.[field] ?? null;
          const base = scope === "daily.previous" ? 1 : 0;
          return context.dailyRows.at(-(base + offset + 1))?.[field] ?? null;
        },
        id,
        label: id,
        requirements: { daily: scope.startsWith("daily"), yearly: scope.startsWith("yearly") },
        valueType: "number",
      });
    }
  }
  const labels = {
    "daily.today.broken_limit_up": "触板后未封住",
    "daily.today.is_limit_up": "收盘涨停",
    "daily.today.is_one_price_limit_up": "一字涨停",
    "daily.today.opened_limit_up": "涨停开盘",
    "daily.today.touched_limit_up": "盘中触及涨停",
  };
  for (const id of LIMIT_FEATURES) {
    registry.register({
      compute(context, offset = 0) {
        const index = context.dailyRows.length - offset - 1;
        if (index < 0) return { qualityIssues: ["missing_limit_feature_bar"], value: false };
        const resolved = limitFeatureValue(id, { bar: context.dailyRows[index], previousBar: context.dailyRows[index - 1] ?? null, security: context.security });
        return { evidence: resolved.state, qualityIssues: resolved.state.qualityIssues, value: resolved.value };
      },
      id,
      label: labels[id],
      requirements: { daily: true, lookback: 2 },
      valueType: "boolean",
    });
  }
}

function registerIndicators(registry) {
  registry.register({ calculate: (rows, params, offset) => ({ value: average(rows, params.field, params.period, offset) }), id: "moving_average", label: "移动平均线 MA", outputs: ["value"], paramSchema: { field: { default: "close", options: FIELDS, type: "enum" }, period: { default: 20, max: 500, min: 1, type: "integer" } } });
  registry.register({ calculate(rows, params, offset) { const end = rows.length - offset; const values = rows.slice(Math.max(0, end - params.period), end).map((row) => row[params.field]); return values.length === params.period && values.every(Number.isFinite) ? calculateBollWindow(values, { multiplier: params.multiplier }) : {}; }, id: "boll", label: "布林线 BOLL", outputs: ["upper", "middle", "lower"], paramSchema: { field: { default: "close", options: FIELDS, type: "enum" }, multiplier: { default: 2, max: 10, min: 0.1, type: "number" }, period: { default: 20, max: 500, min: 1, type: "integer" } } });
  registry.register({ calculate: (rows, params, offset) => ({ value: extreme(rows, params.field, params.period, params.mode, offset) }), id: "rolling_extreme", label: "滚动最高/最低", outputs: ["value"], paramSchema: { field: { default: "high", options: FIELDS, type: "enum" }, mode: { default: "max", options: ["max", "min"], type: "enum" }, period: { default: 20, max: 500, min: 1, type: "integer" } } });
}

function result(evidence, ok, qualityIssues = []) {
  return { evidence, ok, qualityIssues };
}

function registerRules(registry) {
  registry.register({
    describe: (p) => `最近连续${p.transitions}年年度${p.field}逐年下降`,
    evaluate({ context, params, runtime }) {
      const points = context.annualRows.slice(-(params.transitions + 1));
      const comparisons = points.slice(1).map((point, index) => runtime.compare(point[params.field], points[index][params.field], params.comparator));
      const consecutive = points.length === params.transitions + 1 && points.slice(1).every((point, index) => point.year === points[index].year + 1);
      return result({ comparisons, points, requiredPoints: params.transitions + 1 }, consecutive && comparisons.length === params.transitions && comparisons.every(Boolean), points.length < params.transitions + 1 ? ["insufficient_consecutive_complete_years"] : []);
    },
    id: "sequence_compare", label: "序列连续比较", paramSchema: { comparator: { default: "lt", options: COMPARATORS, type: "enum" }, field: { default: "close", options: FIELDS, type: "enum" }, transitions: { default: 3, max: 20, min: 1, type: "integer" } },
    prefilter: true, requirements: { yearly: true },
  });
  registry.register({
    describe: (p) => `${p.left} ${p.operator} ${p.right}`,
    evaluate({ params, runtime }) { const left = runtime.operand(params.left); const right = runtime.operand(params.right); return result({ left, operator: params.operator, right }, runtime.compare(left, right, params.operator), [left, right].every(Number.isFinite) ? [] : ["invalid_feature_value"]); },
    id: "value_compare", label: "数值比较", paramSchema: { left: { default: "daily.today.close", type: "operand" }, operator: { default: "gt", options: COMPARATORS, type: "enum" }, right: { default: "yearly.previous.high", type: "operand" } }, requirements: {},
  });
  registry.register({
    describe: (p) => `${p.left}${p.direction === "up" ? "上穿" : "下穿"}${p.right}`,
    evaluate({ params, runtime }) { const left = runtime.operand(params.left); const right = runtime.operand(params.right); const previousLeft = runtime.operand(params.left, 1); const previousRight = runtime.operand(params.right, 1); const valid = [left, right, previousLeft, previousRight].every(Number.isFinite); const ok = pDirection(params.direction, previousLeft, previousRight, left, right); return result({ direction: params.direction, left, previousLeft, previousRight, right }, valid && ok, valid ? [] : ["invalid_feature_value"]); },
    id: "cross", label: "上穿/下穿", paramSchema: { direction: { default: "up", options: ["up", "down"], type: "enum" }, left: { default: "daily.today.close", type: "operand" }, right: { default: "daily.previous.close", type: "operand" } }, requirements: { daily: true, lookback: 2 },
  });
  registry.register({
    describe: (p) => `${p.current}在本年首次${p.comparator}${p.baseline}`,
    evaluate({ context, params, runtime }) { const current = runtime.operand(params.current); const baseline = runtime.operand(params.baseline); const history = context.currentYearBeforeToday.map((row) => row[params.historyField]).filter(Number.isFinite); const prior = history.filter((value) => runtime.compare(value, baseline, params.comparator)); return result({ baseline, current, historyCount: history.length, priorMatchCount: prior.length, relativeDifferencePct: Number.isFinite(current) && Number.isFinite(baseline) && baseline !== 0 ? ((current - baseline) / baseline) * 100 : null }, runtime.compare(current, baseline, params.comparator) && prior.length === 0, [current, baseline].every(Number.isFinite) ? [] : ["invalid_feature_value"]); },
    id: "first_occurrence", label: "范围内首次满足", outputs: ["relativeDifferencePct"], paramSchema: { baseline: { default: "yearly.previous.high", type: "operand" }, comparator: { default: "gt", options: COMPARATORS, type: "enum" }, current: { default: "daily.today.close", type: "operand" }, historyField: { default: "close", options: FIELDS, type: "enum" } }, requirements: { daily: true, yearly: true },
  });
  registry.register({
    describe: (p) => `${p.feature}${p.expected ? "成立" : "不成立"}`,
    evaluate({ params, runtime }) { const resolved = runtime.feature(params.feature); return result({ actual: resolved.value, expected: params.expected, feature: params.feature, featureEvidence: resolved.evidence }, resolved.value === params.expected, resolved.qualityIssues); },
    id: "boolean_feature", label: "布尔特征判断", paramSchema: { expected: { default: true, type: "boolean" }, feature: { default: "daily.today.is_limit_up", type: "booleanFeature" } }, requirements: {},
  });
  registry.register({
    describe: (p) => `最近${p.lookback}日${p.feature}出现次数${p.operator}${p.count}`,
    evaluate({ context, params, runtime }) { const resolved = Array.from({ length: Math.min(context.dailyRows.length, params.lookback) }, (_v, offset) => runtime.feature(params.feature, offset)); const count = resolved.filter((item) => item.value).length; const enough = resolved.length === params.lookback; return result({ count, feature: params.feature, lookback: params.lookback, operator: params.operator, threshold: params.count }, enough && runtime.compare(count, params.count, params.operator), [...new Set([...resolved.flatMap((item) => item.qualityIssues ?? []), ...(enough ? [] : ["insufficient_daily_lookback"])])]); },
    id: "window_count", label: "窗口出现次数", paramSchema: { count: { default: 1, maxFrom: "lookback", min: 0, type: "integer" }, feature: { default: "daily.today.is_limit_up", type: "booleanFeature" }, lookback: { default: 20, max: 500, min: 1, type: "integer" }, operator: { default: "gte", options: ["eq", "gte", "lte"], type: "enum" } }, requirements: (p) => ({ daily: true, lookback: p.lookback }),
  });
  registry.register({
    describe: (p) => `${p.feature}连续至少${p.minimum}日`,
    evaluate({ context, params, runtime }) { let count = 0; const issues = new Set(); for (let offset = 0; offset < context.dailyRows.length; offset += 1) { const resolved = runtime.feature(params.feature, offset); (resolved.qualityIssues ?? []).forEach((issue) => issues.add(issue)); if (!resolved.value) break; count += 1; } return result({ count, feature: params.feature, minimum: params.minimum }, count >= params.minimum, [...issues]); },
    id: "consecutive_count", label: "连续出现次数", paramSchema: { feature: { default: "daily.today.is_limit_up", type: "booleanFeature" }, minimum: { default: 2, max: 500, min: 1, type: "integer" } }, requirements: (p) => ({ daily: true, lookback: p.minimum }),
  });
}

function pDirection(direction, previousLeft, previousRight, left, right) {
  return direction === "up" ? previousLeft <= previousRight && left > right : previousLeft >= previousRight && left < right;
}

function createBuiltinRegistries() {
  const registries = createCapabilityRegistries();
  registerFeatures(registries.features);
  registerIndicators(registries.indicators);
  registerRules(registries.rules);
  return registries;
}

module.exports = { COMPARATORS, FIELDS, createBuiltinRegistries };
