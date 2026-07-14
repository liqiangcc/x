"use strict";

const { createBuiltinRegistries } = require("./builtins");

const MAX_INDICATORS = 20;
const MAX_RULES = 30;

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

function keyValue(value, field) {
  const normalized = String(value ?? "").trim();
  if (!/^[a-z][a-z0-9_]{0,47}$/.test(normalized)) {
    throw strategyError("invalid_strategy_config", `${field} must use lowercase letters, numbers, and underscores.`, field);
  }
  return normalized;
}

function normalizeParam(value, schema, params, field, registries) {
  const normalized = value ?? schema.default;
  if (schema.type === "boolean") return normalized !== false;
  if (schema.type === "enum") {
    if (!schema.options.includes(normalized)) throw strategyError("invalid_strategy_config", `${field} is not supported.`, field);
    return normalized;
  }
  if (schema.type === "integer" || schema.type === "number") {
    const max = schema.maxFrom ? params[schema.maxFrom] : schema.max;
    const valid = schema.type === "integer" ? Number.isInteger(normalized) : Number.isFinite(normalized);
    if (!valid || normalized < schema.min || (Number.isFinite(max) && normalized > max)) {
      throw strategyError("invalid_strategy_config", `${field} must be between ${schema.min} and ${max}.`, field);
    }
    return normalized;
  }
  if (schema.type === "booleanFeature") {
    const descriptor = registries.features.get(String(normalized));
    if (descriptor.valueType !== "boolean") throw strategyError("invalid_strategy_operand", `${field} must reference a boolean feature.`, field);
    return String(normalized);
  }
  if (schema.type === "operand") return String(normalized ?? "");
  throw strategyError("invalid_strategy_schema", `${field} uses an unsupported parameter type.`, field);
}

function normalizeParams(input, descriptor, field, registries) {
  const raw = input ?? {};
  const params = {};
  for (const [name, schema] of Object.entries(descriptor.paramSchema ?? {})) {
    params[name] = normalizeParam(raw[name], schema, { ...raw, ...params }, `${field}.${name}`, registries);
  }
  return params;
}

function normalizeOperand(value, field, indicators, registries) {
  const operand = String(value ?? "");
  if (registries.features.values.has(operand)) {
    if (registries.features.get(operand).valueType !== "number") {
      throw strategyError("invalid_strategy_operand", `${field} must reference a numeric value.`, field);
    }
    return operand;
  }
  const match = operand.match(/^indicator\.([a-z][a-z0-9_]{0,47})\.([a-z][a-z0-9_]*)$/);
  const indicator = match ? indicators.get(match[1]) : null;
  if (!indicator || !registries.indicators.get(indicator.type).outputs.includes(match[2])) {
    throw strategyError("invalid_strategy_operand", `${field} is not a registered feature or indicator output.`, field);
  }
  return operand;
}

function normalizeDefinition(input, registries = createBuiltinRegistries()) {
  if (input?.schemaVersion !== 3 || input?.type !== "composite") {
    throw strategyError("unsupported_strategy_type", "Only composite schema version 3 is supported.");
  }
  if (!Array.isArray(input.indicators) || input.indicators.length > MAX_INDICATORS) {
    throw strategyError("invalid_strategy_config", `A strategy can contain at most ${MAX_INDICATORS} indicators.`, "strategy.indicators");
  }
  if (!Array.isArray(input.rules) || input.rules.length < 1 || input.rules.length > MAX_RULES) {
    throw strategyError("invalid_strategy_config", `A strategy must contain between 1 and ${MAX_RULES} rules.`, "strategy.rules");
  }
  const indicators = input.indicators.map((item, index) => {
    const field = `strategy.indicators[${index}]`;
    const descriptor = registries.indicators.get(item?.type);
    return { key: keyValue(item?.key, `${field}.key`), params: normalizeParams(item?.params, descriptor, `${field}.params`, registries), type: descriptor.id };
  });
  const indicatorMap = new Map(indicators.map((item) => [item.key, item]));
  if (indicatorMap.size !== indicators.length) throw strategyError("duplicate_strategy_key", "Indicator keys must be unique.", "strategy.indicators");
  const rules = input.rules.map((item, index) => {
    const field = `strategy.rules[${index}]`;
    const descriptor = registries.rules.get(item?.type);
    const params = normalizeParams(item?.params, descriptor, `${field}.params`, registries);
    for (const [name, schema] of Object.entries(descriptor.paramSchema ?? {})) {
      if (schema.type === "operand") params[name] = normalizeOperand(params[name], `${field}.params.${name}`, indicatorMap, registries);
    }
    return { key: keyValue(item?.key, `${field}.key`), params, type: descriptor.id };
  });
  const ruleKeys = rules.map((rule) => rule.key);
  if (new Set(ruleKeys).size !== rules.length) throw strategyError("duplicate_strategy_key", "Rule keys must be unique.", "strategy.rules");
  const composition = input.composition ?? { operator: "all", ruleKeys };
  if (composition.operator !== "all") throw strategyError("unsupported_strategy_operator", "Only AND rule composition is currently supported.", "strategy.composition.operator");
  if (!Array.isArray(composition.ruleKeys) || composition.ruleKeys.length !== rules.length || new Set(composition.ruleKeys).size !== rules.length || composition.ruleKeys.some((key) => !ruleKeys.includes(key))) {
    throw strategyError("invalid_strategy_composition", "Composition must reference every rule exactly once.", "strategy.composition.ruleKeys");
  }
  const emission = { mode: input.emission?.mode ?? "on_match" };
  if (!["on_match", "on_enter"].includes(emission.mode)) throw strategyError("invalid_strategy_emission", "Unsupported emission mode.", "strategy.emission.mode");
  const ranking = (input.ranking?.length ? input.ranking : [{ direction: "asc", nulls: "last", operand: { id: "daily.today.close", kind: "feature" } }]).map((item, index) => {
    const field = `strategy.ranking[${index}]`;
    if (!["asc", "desc"].includes(item.direction) || !["first", "last"].includes(item.nulls)) throw strategyError("invalid_strategy_ranking", `${field} is invalid.`, field);
    const operand = item.operand ?? {};
    if (operand.kind === "feature") {
      const feature = registries.features.get(operand.id);
      if (feature.valueType !== "number") throw strategyError("invalid_strategy_ranking", `${field} must reference a numeric feature.`, field);
    }
    else if (operand.kind === "ruleOutput") {
      const rule = rules.find((entry) => entry.key === operand.key);
      if (!rule || !registries.rules.get(rule.type).outputs?.includes(operand.output)) throw strategyError("invalid_strategy_ranking", `${field} references an unknown rule output.`, field);
    } else throw strategyError("invalid_strategy_ranking", `${field} uses an unsupported operand.`, field);
    return { direction: item.direction, nulls: item.nulls, operand: { ...operand } };
  });
  return Object.freeze({ composition: { operator: "all", ruleKeys: [...composition.ruleKeys] }, emission, indicators, ranking, rules, schemaVersion: 3, type: "composite" });
}

function normalizedContext(context) {
  const date = context?.features?.today?.date ?? context?.isoDate;
  const dailyRows = (context?.dailyRows ?? []).filter((row) => !date || row.date <= date);
  const annualRows = (context?.features?.completedYears ?? []).map((row) => ({ ...row, year: Number(row.year ?? String(row.date).slice(0, 4)) }));
  const year = String(date ?? "").slice(0, 4);
  return {
    annualRows,
    currentYearBeforeToday: context?.features?.currentYearBeforeToday ?? dailyRows.filter((row) => row.date?.startsWith(`${year}-`) && row.date < date),
    dailyRows,
    isoDate: date,
    security: context?.security,
  };
}

function requirementValue(requirements, params) {
  return typeof requirements === "function" ? requirements(params) : (requirements ?? {});
}

function mergeRequirements(target, source) {
  target.daily ||= source.daily === true;
  target.yearly ||= source.yearly === true;
  target.maxDailyLookback = Math.max(target.maxDailyLookback, source.lookback ?? 0);
}

function compileV3Strategy(input, { registries = createBuiltinRegistries() } = {}) {
  const definition = normalizeDefinition(input, registries);
  const indicatorMap = new Map(definition.indicators.map((item) => [item.key, item]));
  const ruleMap = new Map(definition.rules.map((item) => [item.key, item]));
  const requirements = { daily: false, maxDailyLookback: 0, yearly: false };
  for (const indicator of definition.indicators) {
    const descriptor = registries.indicators.get(indicator.type);
    mergeRequirements(requirements, { daily: true, lookback: indicator.params.period });
    mergeRequirements(requirements, requirementValue(descriptor.requirements, indicator.params));
  }
  for (const rule of definition.rules) {
    const descriptor = registries.rules.get(rule.type);
    mergeRequirements(requirements, requirementValue(descriptor.requirements, rule.params));
    for (const [name, schema] of Object.entries(descriptor.paramSchema ?? {})) {
      if (schema.type !== "operand") continue;
      const operand = rule.params[name];
      if (registries.features.values.has(operand)) mergeRequirements(requirements, registries.features.get(operand).requirements);
      else mergeRequirements(requirements, { daily: true, lookback: indicatorMap.get(operand.split(".")[1])?.params.period ?? 0 });
    }
  }
  const descriptions = definition.rules.map((rule) => registries.rules.get(rule.type).describe(rule.params));

  function evaluateRules(context, selectedRules = definition.rules) {
    const featureCache = new Map();
    const indicatorCache = new Map();
    const runtime = {
      compare,
      feature(id, offset = 0) {
        const key = `${id}:${offset}`;
        if (!featureCache.has(key)) {
          const value = registries.features.get(id).compute(context, offset);
          featureCache.set(key, value && typeof value === "object" && Object.hasOwn(value, "value") ? value : { qualityIssues: [], value });
        }
        return featureCache.get(key);
      },
      operand(operand, offset = 0) {
        if (registries.features.values.has(operand)) return runtime.feature(operand, offset).value;
        const [, key, output] = operand.split(".");
        const cacheKey = `${key}:${offset}`;
        if (!indicatorCache.has(cacheKey)) {
          const indicator = indicatorMap.get(key);
          indicatorCache.set(cacheKey, registries.indicators.get(indicator.type).calculate(context.dailyRows, indicator.params, offset));
        }
        return indicatorCache.get(cacheKey)?.[output] ?? null;
      },
    };
    return selectedRules.map((rule) => {
      const evaluated = registries.rules.get(rule.type).evaluate({ context, params: rule.params, runtime });
      return { ...evaluated, evidence: { key: rule.key, type: rule.type, ...evaluated.evidence } };
    });
  }

  return {
    createEvaluationState: () => ({ previousMatched: false }),
    definition,
    description: descriptions.join("，并且"),
    engineVersion: 8,
    evaluate(rawContext, state = null) {
      const context = normalizedContext(rawContext);
      const results = evaluateRules(context);
      const conditionMatched = definition.composition.ruleKeys.every((key) => results.find((item) => item.evidence.key === key)?.ok);
      const emitted = definition.emission.mode === "on_match" || !state ? conditionMatched : conditionMatched && !state.previousMatched;
      if (state) state.previousMatched = conditionMatched;
      const ruleResults = new Map(results.map((item) => [item.evidence.key, item]));
      const rankingValues = definition.ranking.map(({ operand }) => operand.kind === "ruleOutput"
        ? ruleResults.get(operand.key)?.evidence?.[operand.output] ?? null
        : (() => {
          const runtimeContext = normalizedContext(rawContext);
          if (registries.features.values.has(operand.id)) {
            const value = registries.features.get(operand.id).compute(runtimeContext, 0);
            return value && typeof value === "object" && Object.hasOwn(value, "value") ? value.value : value;
          }
          return null;
        })());
      const today = context.dailyRows.at(-1);
      return {
        evidence: {
          rankingValues,
          rule_summary: descriptions.join("，并且"),
          rules: results.map((item) => ({ ...item.evidence, ok: item.ok, qualityIssues: item.qualityIssues })),
          today_close: today?.close ?? null,
          today_date: today?.date ?? null,
        },
        ok: emitted,
        qualityIssues: [...new Set(results.flatMap((item) => item.qualityIssues ?? []))],
        rankingValues,
      };
    },
    hasYearlyPrefilter: definition.rules.some((rule) => registries.rules.get(rule.type).prefilter),
    requirements,
    compareCandidates(left, right) {
      for (let index = 0; index < definition.ranking.length; index += 1) {
        const setting = definition.ranking[index];
        const leftValue = left.rankingValues?.[index] ?? left.evidence?.rankingValues?.[index];
        const rightValue = right.rankingValues?.[index] ?? right.evidence?.rankingValues?.[index];
        const leftNull = !Number.isFinite(leftValue);
        const rightNull = !Number.isFinite(rightValue);
        if (leftNull !== rightNull) return leftNull === (setting.nulls === "last") ? 1 : -1;
        if (!leftNull && leftValue !== rightValue) return (leftValue - rightValue) * (setting.direction === "asc" ? 1 : -1);
      }
      return left.securityKey.localeCompare(right.securityKey);
    },
    yearlyPrefilter(completedYears) {
      const context = normalizedContext({ features: { completedYears } });
      const selected = definition.rules.filter((rule) => registries.rules.get(rule.type).prefilter);
      return selected.length === 0 || evaluateRules(context, selected).every((item) => item.ok);
    },
  };
}

module.exports = { compileV3Strategy, normalizeDefinition, strategyError };
