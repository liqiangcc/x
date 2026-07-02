"use strict";

const { compareValues, marginPct, numberAtPath } = require("./utils");
const { selectWindow } = require("./window_utils");

const OPERATORS = new Set(["gt", "gte", "lt", "lte", "eq"]);

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function evaluateWindowAverage(context, params = {}) {
  const selected = selectWindow(context, params);
  const current = numberAtPath(context, params.current);
  const operator = String(params.operator ?? "");
  const multiplier = Number(params.multiplier ?? 1);
  const averageValue = selected.ok ? average(selected.values) : null;
  const threshold = Number.isFinite(averageValue) && Number.isFinite(multiplier)
    ? averageValue * multiplier
    : null;
  const evidence = {
    ...selected.evidence,
    average_value: averageValue,
    current_path: params.current ?? null,
    current_value: current,
    margin_pct: marginPct(current, threshold),
    multiplier,
    operator,
    threshold_value: threshold,
  };

  if (!selected.ok) {
    return {
      evidence,
      ok: false,
      qualityIssues: selected.qualityIssues,
    };
  }
  if (![current, threshold].every(Number.isFinite) || !OPERATORS.has(operator)) {
    return {
      evidence,
      ok: false,
      qualityIssues: [params.qualityIssue ?? "invalid_feature_value"],
    };
  }

  return {
    evidence,
    ok: compareValues(current, threshold, operator),
    qualityIssues: [],
  };
}

module.exports = {
  evaluateWindowAverage,
};
