"use strict";

const { compareValues, marginPct, numberAtPath } = require("./utils");
const { selectWindow } = require("./window_utils");

const BANDS = new Set(["lower", "middle", "upper"]);
const OPERATORS = new Set(["gt", "gte", "lt", "lte", "eq"]);
const STDDEV_MODES = new Set(["population", "sample"]);

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values, mean, mode) {
  const denominator = mode === "sample" ? values.length - 1 : values.length;
  if (denominator <= 0) {
    return null;
  }
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / denominator;
  return Math.sqrt(variance);
}

function evaluateWindowBand(context, params = {}) {
  const selected = selectWindow(context, params);
  const current = numberAtPath(context, params.current);
  const operator = String(params.operator ?? "");
  const band = String(params.band ?? "");
  const multiplier = Number(params.multiplier);
  const stddevMode = String(params.stddevMode ?? "population");
  const middle = selected.ok ? average(selected.values) : null;
  const stddev = selected.ok && Number.isFinite(middle) && STDDEV_MODES.has(stddevMode)
    ? standardDeviation(selected.values, middle, stddevMode)
    : null;
  const upper = Number.isFinite(middle) && Number.isFinite(stddev) && Number.isFinite(multiplier)
    ? middle + multiplier * stddev
    : null;
  const lower = Number.isFinite(middle) && Number.isFinite(stddev) && Number.isFinite(multiplier)
    ? middle - multiplier * stddev
    : null;
  const bandValues = { lower, middle, upper };
  const target = bandValues[band];
  const evidence = {
    ...selected.evidence,
    band,
    current_path: params.current ?? null,
    current_value: current,
    lower,
    margin_pct: marginPct(current, target),
    middle,
    multiplier,
    operator,
    stddev,
    stddev_mode: stddevMode,
    target_value: target ?? null,
    upper,
  };

  if (!selected.ok) {
    return {
      evidence,
      ok: false,
      qualityIssues: selected.qualityIssues,
    };
  }
  if (
    !BANDS.has(band) ||
    !OPERATORS.has(operator) ||
    !STDDEV_MODES.has(stddevMode) ||
    !Number.isFinite(multiplier) ||
    multiplier < 0 ||
    ![current, target].every(Number.isFinite)
  ) {
    return {
      evidence,
      ok: false,
      qualityIssues: [params.qualityIssue ?? "invalid_feature_value"],
    };
  }

  return {
    evidence,
    ok: compareValues(current, target, operator),
    qualityIssues: [],
  };
}

module.exports = {
  evaluateWindowBand,
};
