"use strict";

const { calculateBollWindow } = require("../signals/indicators/boll");
const { LIMIT_FEATURES, limitFeatureValue } = require("../signals/limit_state");
const {
  evaluateYearDeclineCloseBreakout,
  normalizeYearDeclineConfig,
} = require("../signals/signals/year_decline_close_breakout");
const { compileV3Strategy } = require("./v3/compiler");
const { createStrategyCatalog, v3Templates } = require("./v3/catalog");
const { toV3Definition } = require("./v3/migrate");

const COMPARATORS = new Set(["eq", "gt", "gte", "lt", "lte"]);
const FIELD_NAMES = new Set(["amount", "close", "high", "low", "open", "volume"]);
const INDICATOR_TYPES = new Set(["boll", "moving_average", "rolling_extreme"]);
const RULE_TYPES = new Set(["boolean_feature", "consecutive_count", "cross", "first_occurrence", "sequence_compare", "value_compare", "window_count"]);
const BOOLEAN_FEATURES = new Set(LIMIT_FEATURES);
const BOOLEAN_FEATURE_LABELS = Object.freeze({
  "daily.today.broken_limit_up": "触板后未封住",
  "daily.today.is_limit_up": "收盘涨停",
  "daily.today.is_one_price_limit_up": "一字涨停",
  "daily.today.opened_limit_up": "涨停开盘",
  "daily.today.touched_limit_up": "盘中触及涨停",
});
const MAX_INDICATORS = 20;
const MAX_RULES = 30;
const MAX_DAILY_LOOKBACK = 500;

const THREE_YEAR_DECLINE_BREAKOUT_RULES = [
  { key: "three_year_decline", params: { comparator: "lt", continuity: "calendar_year", field: "close", selection: "latest", source: "yearly.completed", transitions: 3 }, type: "sequence_compare" },
  { key: "first_breakout", params: { baseline: "yearly.previous.high", comparator: "gt", current: "daily.today.close", historyField: "close", historySource: "daily.current_year_before_today" }, type: "first_occurrence" },
];

const STRATEGY_BUILDER_CATALOG = Object.freeze({
  features: [
    { fields: [...FIELD_NAMES], id: "daily.today", label: "今日日线", series: false },
    { fields: [...FIELD_NAMES], id: "daily.previous", label: "上一交易日", series: false },
    { fields: [...FIELD_NAMES], id: "daily.current_year_before_today", label: "本年度今日以前日线", series: true },
    { fields: [...FIELD_NAMES], id: "yearly.previous", label: "上一完整年度", series: false },
    { fields: [...FIELD_NAMES], id: "yearly.completed", label: "历史完整年度", series: true },
  ],
  derivedFeatures: LIMIT_FEATURES.map((id) => ({ id, type: "boolean" })),
  indicators: [
    { id: "moving_average", label: "移动平均线 MA", outputs: ["value"], params: { field: "close", period: 20 } },
    { id: "boll", label: "布林线 BOLL", outputs: ["upper", "middle", "lower"], params: { field: "close", multiplier: 2, period: 20 } },
    { id: "rolling_extreme", label: "滚动最高/最低", outputs: ["value"], params: { field: "high", mode: "max", period: 20 } },
  ],
  limits: { indicators: MAX_INDICATORS, lookback: MAX_DAILY_LOOKBACK, rules: MAX_RULES },
  operators: [...COMPARATORS],
  rules: [
    { category: "state", id: "sequence_compare", label: "序列连续比较" },
    { category: "state", id: "value_compare", label: "数值比较" },
    { category: "event", id: "cross", label: "上穿/下穿" },
    { category: "event", id: "first_occurrence", label: "范围内首次满足" },
    { category: "event", id: "boolean_feature", label: "布尔特征判断" },
    { category: "state", id: "window_count", label: "窗口出现次数" },
    { category: "event", id: "consecutive_count", label: "连续出现次数" },
  ],
  schemaVersion: 2,
  templates: [
    {
      defaultDefinition: { indicators: [], operator: "all", rules: THREE_YEAR_DECLINE_BREAKOUT_RULES, schemaVersion: 2, templateId: "three_year_decline_breakout", type: "capability_composite" },
      description: "最近至少连续3年年度收盘逐年降低，并且本年度今日收盘首次突破去年最高价",
      id: "three_year_decline_breakout",
      label: "连续下跌3年后首次突破",
    },
    {
      defaultDefinition: { indicators: [], operator: "all", rules: [{ key: "first_breakout", params: { baseline: "yearly.previous.high", comparator: "gt", current: "daily.today.close", historyField: "close", historySource: "daily.current_year_before_today" }, type: "first_occurrence" }], schemaVersion: 2, templateId: "custom_composite", type: "capability_composite" },
      description: "从空白组合开始添加指标和规则",
      id: "custom_composite",
      label: "自定义规则组合",
    },
    {
      defaultDefinition: { indicators: [], operator: "all", rules: [{ key: "close_limit_up", params: { expected: true, feature: "daily.today.is_limit_up" }, type: "boolean_feature" }], schemaVersion: 2, templateId: "daily_limit_up", type: "capability_composite" },
      description: "今日收盘达到涨停状态",
      id: "daily_limit_up",
      label: "今日收盘涨停",
    },
    {
      defaultDefinition: { indicators: [], operator: "all", rules: [{ key: "close_limit_up", params: { expected: true, feature: "daily.today.is_limit_up" }, type: "boolean_feature" }, { key: "first_in_20", params: { count: 1, feature: "daily.today.is_limit_up", lookback: 20, operator: "eq" }, type: "window_count" }], schemaVersion: 2, templateId: "first_limit_up_20", type: "capability_composite" },
      description: "今日收盘涨停，并且是最近20个交易日内第一次涨停",
      id: "first_limit_up_20",
      label: "最近20日首板",
    },
    {
      defaultDefinition: { indicators: [], operator: "all", rules: [{ key: "two_consecutive_limit_up", params: { feature: "daily.today.is_limit_up", minimum: 2 }, type: "consecutive_count" }], schemaVersion: 2, templateId: "two_consecutive_limit_up", type: "capability_composite" },
      description: "截至今日连续至少2个交易日收盘涨停",
      id: "two_consecutive_limit_up",
      label: "二连板及以上",
    },
  ],
});

function strategyError(code, message, field = "strategy") {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 422;
  error.issues = [{ field, message }];
  return error;
}

function compare(left, right, operator) {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  if (operator === "gt") return left > right;
  if (operator === "gte") return left >= right;
  if (operator === "lt") return left < right;
  if (operator === "lte") return left <= right;
  return left === right;
}

function integer(value, { fallback, field, max, min = 1 }) {
  const normalized = value ?? fallback;
  if (!Number.isInteger(normalized) || normalized < min || normalized > max) {
    throw strategyError("invalid_strategy_config", `${field} must be an integer between ${min} and ${max}.`, field);
  }
  return normalized;
}

function enumValue(value, allowed, fallback, field) {
  const normalized = value ?? fallback;
  if (!allowed.has(normalized)) throw strategyError("invalid_strategy_config", `${field} is not supported.`, field);
  return normalized;
}

function keyValue(value, field) {
  const normalized = String(value ?? "").trim();
  if (!/^[a-z][a-z0-9_]{0,47}$/.test(normalized)) {
    throw strategyError("invalid_strategy_config", `${field} must use lowercase letters, numbers, and underscores.`, field);
  }
  return normalized;
}

function fieldValue(value, field) {
  return enumValue(value, FIELD_NAMES, "close", field);
}

function normalizeIndicator(input, index) {
  const field = `strategy.indicators[${index}]`;
  const type = enumValue(input?.type, INDICATOR_TYPES, null, `${field}.type`);
  const params = input?.params ?? {};
  const normalized = {
    key: keyValue(input?.key, `${field}.key`),
    params: {
      field: fieldValue(params.field, `${field}.params.field`),
      period: integer(params.period, { fallback: 20, field: `${field}.params.period`, max: MAX_DAILY_LOOKBACK }),
    },
    type,
  };
  if (type === "boll") {
    const multiplier = params.multiplier ?? 2;
    if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier > 10) {
      throw strategyError("invalid_strategy_config", `${field}.params.multiplier must be greater than 0 and at most 10.`, `${field}.params.multiplier`);
    }
    normalized.params.multiplier = multiplier;
  }
  if (type === "rolling_extreme") {
    normalized.params.mode = enumValue(params.mode, new Set(["max", "min"]), "max", `${field}.params.mode`);
  }
  return normalized;
}

function normalizeOperand(value, field, indicators) {
  const operand = String(value ?? "");
  const feature = operand.match(/^(daily\.(?:today|previous)|yearly\.previous)\.(amount|close|high|low|open|volume)$/);
  if (feature) return operand;
  const indicator = operand.match(/^indicator\.([a-z][a-z0-9_]{0,47})\.(value|upper|middle|lower)$/);
  if (!indicator) throw strategyError("invalid_strategy_operand", `${field} is not a registered scalar feature or indicator output.`, field);
  const definition = indicators.get(indicator[1]);
  if (!definition) throw strategyError("unknown_strategy_indicator", `${field} references an unknown indicator.`, field);
  const allowed = definition.type === "boll" ? new Set(["lower", "middle", "upper"]) : new Set(["value"]);
  if (!allowed.has(indicator[2])) throw strategyError("invalid_strategy_operand", `${field} references an output that the indicator does not provide.`, field);
  return operand;
}

function normalizeRule(input, index, indicators) {
  const field = `strategy.rules[${index}]`;
  const type = enumValue(input?.type, RULE_TYPES, null, `${field}.type`);
  const params = input?.params ?? {};
  const category = new Set(["boolean_feature", "consecutive_count", "cross", "first_occurrence"]).has(type) ? "event" : "state";
  const normalized = { category, key: keyValue(input?.key, `${field}.key`), params: {}, type };
  if (type === "sequence_compare") {
    normalized.params = {
      comparator: enumValue(params.comparator, COMPARATORS, "lt", `${field}.params.comparator`),
      continuity: enumValue(params.continuity, new Set(["calendar_year"]), "calendar_year", `${field}.params.continuity`),
      field: fieldValue(params.field, `${field}.params.field`),
      selection: enumValue(params.selection, new Set(["latest"]), "latest", `${field}.params.selection`),
      source: enumValue(params.source, new Set(["yearly.completed"]), "yearly.completed", `${field}.params.source`),
      transitions: integer(params.transitions, { fallback: 3, field: `${field}.params.transitions`, max: 20 }),
    };
  } else if (type === "first_occurrence") {
    const historyField = fieldValue(params.historyField, `${field}.params.historyField`);
    const current = normalizeOperand(params.current, `${field}.params.current`, indicators);
    const baseline = normalizeOperand(params.baseline, `${field}.params.baseline`, indicators);
    if (current !== `daily.today.${historyField}`) {
      throw strategyError("invalid_strategy_operand", `${field}.params.current must match the daily field used for historical comparison.`, `${field}.params.current`);
    }
    if (!baseline.startsWith("yearly.previous.")) {
      throw strategyError("invalid_strategy_operand", `${field}.params.baseline must use a previous-year field.`, `${field}.params.baseline`);
    }
    normalized.params = {
      baseline,
      comparator: enumValue(params.comparator, COMPARATORS, "gt", `${field}.params.comparator`),
      current,
      historyField,
      historySource: enumValue(params.historySource, new Set(["daily.current_year_before_today"]), "daily.current_year_before_today", `${field}.params.historySource`),
    };
  } else if (type === "cross") {
    normalized.params = {
      direction: enumValue(params.direction, new Set(["down", "up"]), "up", `${field}.params.direction`),
      left: normalizeOperand(params.left, `${field}.params.left`, indicators),
      right: normalizeOperand(params.right, `${field}.params.right`, indicators),
    };
  } else if (type === "boolean_feature") {
    normalized.params = {
      expected: params.expected !== false,
      feature: enumValue(params.feature, BOOLEAN_FEATURES, "daily.today.is_limit_up", `${field}.params.feature`),
    };
  } else if (type === "window_count") {
    const lookback = integer(params.lookback, { fallback: 20, field: `${field}.params.lookback`, max: MAX_DAILY_LOOKBACK });
    normalized.params = {
      count: integer(params.count, { fallback: 1, field: `${field}.params.count`, max: lookback, min: 0 }),
      feature: enumValue(params.feature, BOOLEAN_FEATURES, "daily.today.is_limit_up", `${field}.params.feature`),
      lookback,
      operator: enumValue(params.operator, new Set(["eq", "gte", "lte"]), "gte", `${field}.params.operator`),
    };
  } else if (type === "consecutive_count") {
    normalized.params = {
      feature: enumValue(params.feature, BOOLEAN_FEATURES, "daily.today.is_limit_up", `${field}.params.feature`),
      minimum: integer(params.minimum, { fallback: 2, field: `${field}.params.minimum`, max: MAX_DAILY_LOOKBACK }),
    };
  } else {
    normalized.params = {
      left: normalizeOperand(params.left, `${field}.params.left`, indicators),
      operator: enumValue(params.operator, COMPARATORS, "gt", `${field}.params.operator`),
      right: normalizeOperand(params.right, `${field}.params.right`, indicators),
    };
  }
  return normalized;
}

function normalizeCompositeStrategy(input = {}) {
  if (input.type !== "capability_composite" || input.schemaVersion !== 2) {
    throw strategyError("unsupported_strategy_type", "Only capability_composite schema version 2 is supported.");
  }
  if ((input.operator ?? "all") !== "all") throw strategyError("unsupported_strategy_operator", "Only AND rule composition is currently supported.", "strategy.operator");
  const rawIndicators = input.indicators ?? [];
  const rawRules = input.rules ?? [];
  if (!Array.isArray(rawIndicators) || rawIndicators.length > MAX_INDICATORS) throw strategyError("invalid_strategy_config", `A strategy can contain at most ${MAX_INDICATORS} indicators.`, "strategy.indicators");
  if (!Array.isArray(rawRules) || rawRules.length < 1 || rawRules.length > MAX_RULES) throw strategyError("invalid_strategy_config", `A strategy must contain between 1 and ${MAX_RULES} rules.`, "strategy.rules");
  const indicators = rawIndicators.map(normalizeIndicator);
  const indicatorMap = new Map(indicators.map((indicator) => [indicator.key, indicator]));
  if (indicatorMap.size !== indicators.length) throw strategyError("duplicate_strategy_key", "Indicator keys must be unique.", "strategy.indicators");
  const rules = rawRules.map((rule, index) => normalizeRule(rule, index, indicatorMap));
  if (new Set(rules.map((rule) => rule.key)).size !== rules.length) throw strategyError("duplicate_strategy_key", "Rule keys must be unique.", "strategy.rules");
  if (!rules.some((rule) => rule.category === "event")) throw strategyError("strategy_event_rule_required", "A strategy must contain at least one event rule.", "strategy.rules");
  const templateId = String(input.templateId ?? "custom_composite").trim();
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(templateId)) throw strategyError("invalid_strategy_template", "strategy.templateId is invalid.", "strategy.templateId");
  return Object.freeze({ indicators, operator: "all", rules, schemaVersion: 2, templateId, type: "capability_composite" });
}

function annualRows(context) {
  return (context?.features?.completedYears ?? []).map((row) => ({ ...row, year: Number(row.year ?? String(row.date).slice(0, 4)) }));
}

function dailyRows(context) {
  const todayDate = context?.features?.today?.date ?? context?.isoDate;
  const rows = context?.dailyRows ?? [];
  if (!todayDate || !rows.at(-1)?.date || rows.at(-1).date <= todayDate) return rows;
  return rows.filter((row) => row.date <= todayDate);
}

function movingAverage(rows, field, period, endOffset = 0) {
  const end = rows.length - endOffset;
  const selected = rows.slice(Math.max(0, end - period), end);
  if (selected.length !== period || selected.some((row) => !Number.isFinite(row[field]))) return null;
  return selected.reduce((sum, row) => sum + row[field], 0) / period;
}

function rollingExtreme(rows, field, period, mode, endOffset = 0) {
  const end = rows.length - endOffset;
  const selected = rows.slice(Math.max(0, end - period), end).map((row) => row[field]);
  if (selected.length !== period || selected.some((value) => !Number.isFinite(value))) return null;
  return (mode === "min" ? Math.min : Math.max)(...selected);
}

function bollValue(rows, field, period, multiplier, endOffset = 0) {
  const end = rows.length - endOffset;
  const values = rows.slice(Math.max(0, end - period), end).map((row) => row[field]);
  if (values.length !== period || values.some((value) => !Number.isFinite(value))) return {};
  return calculateBollWindow(values, { multiplier });
}

function calculateIndicators(definitions, rows) {
  const values = new Map();
  for (const definition of definitions) {
    const { field, period } = definition.params;
    if (definition.type === "moving_average") {
      values.set(definition.key, {
        current: { value: movingAverage(rows, field, period) },
        previous: { value: movingAverage(rows, field, period, 1) },
      });
    } else if (definition.type === "rolling_extreme") {
      values.set(definition.key, {
        current: { value: rollingExtreme(rows, field, period, definition.params.mode) },
        previous: { value: rollingExtreme(rows, field, period, definition.params.mode, 1) },
      });
    } else {
      values.set(definition.key, {
        current: bollValue(rows, field, period, definition.params.multiplier),
        previous: bollValue(rows, field, period, definition.params.multiplier, 1),
      });
    }
  }
  return values;
}

function resolveOperand(operand, context, indicators, offset = 0) {
  const indicator = operand.match(/^indicator\.([^.]+)\.([^.]+)$/);
  if (indicator) return indicators.get(indicator[1])?.[offset === 0 ? "current" : "previous"]?.[indicator[2]] ?? null;
  const parts = operand.split(".");
  if (parts[0] === "daily") {
    const rows = dailyRows(context);
    const baseOffset = parts[1] === "previous" ? 1 : 0;
    return rows.at(-(baseOffset + offset + 1))?.[parts[2]] ?? null;
  }
  if (parts[0] === "yearly" && parts[1] === "previous") return annualRows(context).at(-1)?.[parts[2]] ?? null;
  return null;
}

function limitFeatureAt(feature, context, offset = 0) {
  const rows = dailyRows(context);
  const index = rows.length - offset - 1;
  if (index < 0) return { state: { qualityIssues: ["missing_limit_feature_bar"] }, value: false };
  return limitFeatureValue(feature, {
    bar: rows[index],
    previousBar: index > 0 ? rows[index - 1] : null,
    security: context.security,
  });
}

function evaluateRule(rule, context, indicators, evaluationState = null) {
  const evidence = { category: rule.category, key: rule.key, type: rule.type };
  if (rule.type === "sequence_compare") {
    const pointCount = rule.params.transitions + 1;
    const points = annualRows(context).slice(-pointCount);
    const consecutive = points.length === pointCount && points.slice(1).every((point, index) => point.year === points[index].year + 1);
    const comparisons = points.slice(1).map((point, index) => ({
      left: point[rule.params.field],
      ok: compare(point[rule.params.field], points[index][rule.params.field], rule.params.comparator),
      right: points[index][rule.params.field],
    }));
    return { evidence: { ...evidence, comparisons, points, requiredPoints: pointCount }, ok: consecutive && comparisons.length === rule.params.transitions && comparisons.every((item) => item.ok), qualityIssues: points.length < pointCount ? ["insufficient_consecutive_complete_years"] : [] };
  }
  if (rule.type === "first_occurrence") {
    const current = resolveOperand(rule.params.current, context, indicators);
    const baseline = resolveOperand(rule.params.baseline, context, indicators);
    let historyCount;
    let priorMatchCount;
    let previousExtreme;
    if (evaluationState) {
      const state = evaluationState.rules[rule.key] ?? { historyCount: 0, priorMatchCount: 0, previousExtreme: null };
      historyCount = state.historyCount;
      priorMatchCount = state.priorMatchCount;
      previousExtreme = state.previousExtreme;
    } else {
      const year = String(context.isoDate ?? context.features?.today?.date ?? "").slice(0, 4);
      const historyRows = context.features?.currentYearBeforeToday
        ?? dailyRows(context).filter((row) => row.date?.startsWith(`${year}-`) && row.date < context.features?.today?.date);
      const history = historyRows.map((row) => row[rule.params.historyField]).filter(Number.isFinite);
      historyCount = history.length;
      priorMatchCount = history.filter((value) => compare(value, baseline, rule.params.comparator)).length;
      previousExtreme = history.length ? Math.max(...history) : null;
    }
    return { evidence: { ...evidence, baseline, current, historyCount, priorMatchCount, previousExtreme }, ok: compare(current, baseline, rule.params.comparator) && priorMatchCount === 0, qualityIssues: [current, baseline].every(Number.isFinite) ? [] : ["invalid_feature_value"] };
  }
  if (rule.type === "boolean_feature") {
    const resolved = evaluationState?.currentLimitFeatures?.[rule.params.feature] ?? limitFeatureAt(rule.params.feature, context);
    return { evidence: { ...evidence, actual: resolved.value, expected: rule.params.expected, feature: rule.params.feature, limitState: resolved.state }, ok: resolved.value === rule.params.expected, qualityIssues: resolved.state.qualityIssues };
  }
  if (rule.type === "window_count") {
    const rows = dailyRows(context);
    const current = evaluationState?.currentLimitFeatures?.[rule.params.feature];
    const resolved = current
      ? [...(evaluationState.limitFeatures[rule.params.feature]?.history ?? []), current].slice(-rule.params.lookback)
      : Array.from({ length: Math.min(rows.length, rule.params.lookback) }, (_item, offset) => limitFeatureAt(rule.params.feature, context, offset));
    const selectedCount = resolved.length;
    const count = resolved.filter((item) => item.value).length;
    const enoughHistory = selectedCount === rule.params.lookback;
    return { evidence: { ...evidence, count, feature: rule.params.feature, lookback: rule.params.lookback, operator: rule.params.operator, threshold: rule.params.count }, ok: enoughHistory && compare(count, rule.params.count, rule.params.operator), qualityIssues: [...new Set([...resolved.flatMap((item) => item.state.qualityIssues), ...(enoughHistory ? [] : ["insufficient_daily_lookback"])])] };
  }
  if (rule.type === "consecutive_count") {
    const rows = dailyRows(context);
    let count = 0;
    const issues = new Set();
    const current = evaluationState?.currentLimitFeatures?.[rule.params.feature];
    if (current) {
      current.state.qualityIssues.forEach((issue) => issues.add(issue));
      count = current.value ? (evaluationState.limitFeatures[rule.params.feature]?.consecutive ?? 0) + 1 : 0;
    }
    for (let offset = 0; !current && offset < rows.length; offset += 1) {
      const resolved = limitFeatureAt(rule.params.feature, context, offset);
      resolved.state.qualityIssues.forEach((issue) => issues.add(issue));
      if (!resolved.value) break;
      count += 1;
    }
    return { evidence: { ...evidence, count, feature: rule.params.feature, minimum: rule.params.minimum }, ok: count >= rule.params.minimum, qualityIssues: [...issues] };
  }
  const left = resolveOperand(rule.params.left, context, indicators);
  const right = resolveOperand(rule.params.right, context, indicators);
  if (rule.type === "cross") {
    const previousLeft = resolveOperand(rule.params.left, context, indicators, 1);
    const previousRight = resolveOperand(rule.params.right, context, indicators, 1);
    const ok = rule.params.direction === "up"
      ? previousLeft <= previousRight && left > right
      : previousLeft >= previousRight && left < right;
    return { evidence: { ...evidence, direction: rule.params.direction, left, previousLeft, previousRight, right }, ok: [left, right, previousLeft, previousRight].every(Number.isFinite) && ok, qualityIssues: [left, right, previousLeft, previousRight].every(Number.isFinite) ? [] : ["invalid_feature_value"] };
  }
  return { evidence: { ...evidence, left, operator: rule.params.operator, right }, ok: compare(left, right, rule.params.operator), qualityIssues: [left, right].every(Number.isFinite) ? [] : ["invalid_feature_value"] };
}

function ruleDescription(rule) {
  if (rule.type === "sequence_compare") return `最近至少连续${rule.params.transitions}年年度${rule.params.field === "close" ? "收盘" : rule.params.field}逐年降低`;
  if (rule.type === "first_occurrence") return "本年度今日收盘首次突破去年最高价";
  if (rule.type === "cross") return `${rule.params.left}${rule.params.direction === "up" ? "上穿" : "下穿"}${rule.params.right}`;
  if (rule.type === "boolean_feature") return `${BOOLEAN_FEATURE_LABELS[rule.params.feature] ?? rule.params.feature}${rule.params.expected ? "" : "不"}成立`;
  if (rule.type === "window_count") return `最近${rule.params.lookback}日${BOOLEAN_FEATURE_LABELS[rule.params.feature] ?? rule.params.feature}${{ eq: "恰好", gte: "至少", lte: "至多" }[rule.params.operator]}${rule.params.count}次`;
  if (rule.type === "consecutive_count") return `${BOOLEAN_FEATURE_LABELS[rule.params.feature] ?? rule.params.feature}连续至少${rule.params.minimum}日`;
  return `${rule.params.left} ${rule.params.operator} ${rule.params.right}`;
}

function compositeEvidence(definition, context, results) {
  const sequence = results.find((result) => result.evidence.type === "sequence_compare");
  const first = results.find((result) => result.evidence.type === "first_occurrence");
  const today = context.features?.today;
  const previous = dailyRows(context).at(-2);
  const previousYearHigh = first?.evidence.baseline ?? null;
  const breakout = Number.isFinite(today?.close) && Number.isFinite(previousYearHigh) && today.close > previousYearHigh;
  return {
    annual_points: (sequence?.evidence.points ?? []).map((point) => ({ close: point.close, high: point.high, year: point.year })),
    breakout_margin: breakout ? today.close - previousYearHigh : null,
    breakout_margin_pct: breakout ? ((today.close - previousYearHigh) / previousYearHigh) * 100 : null,
    down_transitions: sequence ? sequence.evidence.requiredPoints - 1 : null,
    max_previous_current_year_close: first?.evidence.previousExtreme ?? null,
    previous_year_high: previousYearHigh,
    required_complete_years: sequence?.evidence.requiredPoints ?? null,
    rule_summary: definition.rules.map(ruleDescription).join("，并且"),
    rules: results.map((result) => ({ ...result.evidence, ok: result.ok, qualityIssues: result.qualityIssues })),
    today_close: today?.close ?? null,
    today_change_pct: Number.isFinite(today?.close) && Number.isFinite(previous?.close) && previous.close !== 0 ? ((today.close - previous.close) / previous.close) * 100 : null,
    today_date: today?.date ?? null,
  };
}

function compileCompositeStrategy(input) {
  const definition = normalizeCompositeStrategy(input);
  const yearlyRules = definition.rules.filter((rule) => rule.type === "sequence_compare" && rule.params.source === "yearly.completed");
  const maxLookback = Math.max(0,
    ...definition.indicators.map((indicator) => indicator.params.period),
    ...definition.rules.map((rule) => rule.type === "window_count" ? rule.params.lookback : (rule.type === "consecutive_count" ? rule.params.minimum : 0)));
  return {
    createEvaluationState() {
      return { currentLimitFeatures: {}, limitFeatures: {}, rules: {}, year: null };
    },
    definition,
    description: definition.rules.map(ruleDescription).join("，并且"),
    engineVersion: 7,
    evaluate(context, evaluationState = null) {
      const rows = dailyRows(context);
      const indicatorRows = maxLookback > 0 ? rows.slice(-(maxLookback + 1)) : [];
      const indicators = calculateIndicators(definition.indicators, indicatorRows);
      const year = String(context.isoDate ?? context.features?.today?.date ?? "").slice(0, 4);
      if (evaluationState && evaluationState.year !== year) {
        evaluationState.rules = {};
        evaluationState.year = year;
      }
      if (evaluationState) {
        evaluationState.currentLimitFeatures = {};
        const features = new Set(definition.rules
          .filter((rule) => ["boolean_feature", "consecutive_count", "window_count"].includes(rule.type))
          .map((rule) => rule.params.feature));
        for (const feature of features) evaluationState.currentLimitFeatures[feature] = limitFeatureAt(feature, context);
      }
      const results = definition.rules.map((rule) => evaluateRule(rule, context, indicators, evaluationState));
      if (evaluationState) {
        for (const result of results) {
          if (result.evidence.type !== "first_occurrence" || !Number.isFinite(result.evidence.current)) continue;
          const state = evaluationState.rules[result.evidence.key] ?? { historyCount: 0, priorMatchCount: 0, previousExtreme: null };
          state.historyCount += 1;
          if (compare(result.evidence.current, result.evidence.baseline, definition.rules.find((rule) => rule.key === result.evidence.key).params.comparator)) state.priorMatchCount += 1;
          state.previousExtreme = Number.isFinite(state.previousExtreme) ? Math.max(state.previousExtreme, result.evidence.current) : result.evidence.current;
          evaluationState.rules[result.evidence.key] = state;
        }
        for (const [feature, resolved] of Object.entries(evaluationState.currentLimitFeatures)) {
          const state = evaluationState.limitFeatures[feature] ?? { consecutive: 0, history: [] };
          state.consecutive = resolved.value ? state.consecutive + 1 : 0;
          state.history.push(resolved);
          if (state.history.length > maxLookback) state.history.splice(0, state.history.length - maxLookback);
          evaluationState.limitFeatures[feature] = state;
        }
        evaluationState.currentLimitFeatures = {};
      }
      return {
        evidence: compositeEvidence(definition, context, results),
        ok: results.every((result) => result.ok),
        qualityIssues: [...new Set(results.flatMap((result) => result.qualityIssues))],
      };
    },
    hasYearlyPrefilter: yearlyRules.length > 0,
    requirements: { daily: true, maxDailyLookback: maxLookback, yearly: definition.rules.some((rule) => JSON.stringify(rule.params).includes("yearly.")) },
    yearlyPrefilter(completedYears) {
      const context = { features: { completedYears } };
      return yearlyRules.every((rule) => evaluateRule(rule, context, new Map()).ok);
    },
  };
}

function legacyDefinition(input = {}) {
  const normalized = normalizeYearDeclineConfig(input);
  return {
    definition: { ...normalized, type: "year_decline_close_breakout" },
    description: `最近至少连续${normalized.downTransitions}年年度收盘逐年降低，并且本年度今日收盘首次突破去年最高价`,
    engineVersion: 6,
    evaluate: (context) => evaluateYearDeclineCloseBreakout(context, normalized),
    hasYearlyPrefilter: true,
    requirements: { daily: true, maxDailyLookback: 0, yearly: true },
    yearlyPrefilter(completedYears) {
      const points = completedYears.slice(-(normalized.downTransitions + 1));
      return points.length === normalized.downTransitions + 1
        && points.slice(1).every((point, index) => Number(point.year) === Number(points[index].year) + 1 && point.close < points[index].close);
    },
  };
}

function compileStrategy(input = {}) {
  if (input.type === "composite" && input.schemaVersion === 3) return compileV3Strategy(input);
  return input.type === "capability_composite" ? compileCompositeStrategy(input) : legacyDefinition(input);
}

function defaultCompositeStrategy() {
  return normalizeCompositeStrategy({
    indicators: [],
    operator: "all",
    rules: THREE_YEAR_DECLINE_BREAKOUT_RULES,
    schemaVersion: 2,
    templateId: "three_year_decline_breakout",
    type: "capability_composite",
  });
}

module.exports = {
  STRATEGY_BUILDER_CATALOG: Object.freeze({
    ...createStrategyCatalog(),
    templates: v3Templates(STRATEGY_BUILDER_CATALOG.templates),
  }),
  compileCompositeStrategy,
  compileStrategy,
  defaultCompositeStrategy,
  normalizeCompositeStrategy,
  strategyError,
  toV3Definition,
};
