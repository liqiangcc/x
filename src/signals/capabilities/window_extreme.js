"use strict";

const { compareValues, marginPct, numberAtPath } = require("./utils");
const { selectWindow } = require("./window_utils");

const EXTREMES = new Set(["max", "min"]);
const OPERATORS = new Set(["gt", "gte", "lt", "lte", "eq"]);

function findExtremePoint(points, extreme) {
  return points.reduce((selected, point) => {
    if (!selected) {
      return point;
    }
    if (extreme === "min") {
      return point.value < selected.value ? point : selected;
    }
    return point.value > selected.value ? point : selected;
  }, null);
}

function evaluateWindowExtreme(context, params = {}) {
  const selected = selectWindow(context, params);
  const current = numberAtPath(context, params.current);
  const operator = String(params.operator ?? "");
  const extreme = String(params.extreme ?? "");
  const extremePoint = selected.ok && EXTREMES.has(extreme)
    ? findExtremePoint(selected.evidence.points, extreme)
    : null;
  const extremeValue = extremePoint?.value ?? null;
  const evidence = {
    ...selected.evidence,
    current_path: params.current ?? null,
    current_value: current,
    extreme,
    extreme_date: extremePoint?.date ?? null,
    extreme_index: extremePoint?.index ?? null,
    extreme_value: extremeValue,
    margin_pct: marginPct(current, extremeValue),
    operator,
  };

  if (!selected.ok) {
    return {
      evidence,
      ok: false,
      qualityIssues: selected.qualityIssues,
    };
  }
  if (!EXTREMES.has(extreme) || !OPERATORS.has(operator) || ![current, extremeValue].every(Number.isFinite)) {
    return {
      evidence,
      ok: false,
      qualityIssues: [params.qualityIssue ?? "invalid_feature_value"],
    };
  }

  return {
    evidence,
    ok: compareValues(current, extremeValue, operator),
    qualityIssues: [],
  };
}

module.exports = {
  evaluateWindowExtreme,
};
