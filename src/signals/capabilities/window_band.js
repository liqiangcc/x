"use strict";

const { compareValues, marginPct, numberAtPath } = require("./utils");
const { selectWindow } = require("./window_utils");
const { STDDEV_MODES, calculateBollWindow } = require("../indicators/boll");

const BANDS = new Set(["lower", "middle", "upper"]);
const OPERATORS = new Set(["gt", "gte", "lt", "lte", "eq"]);
function evaluateWindowBand(context, params = {}) {
  const selected = selectWindow(context, params);
  const current = numberAtPath(context, params.current);
  const operator = String(params.operator ?? "");
  const band = String(params.band ?? "");
  const multiplier = Number(params.multiplier);
  const stddevMode = String(params.stddevMode ?? "population");
  let boll = null;
  if (selected.ok && STDDEV_MODES.has(stddevMode) && Number.isFinite(multiplier) && multiplier >= 0) {
    try {
      boll = calculateBollWindow(selected.values, { multiplier, stddevMode });
    } catch {
      boll = null;
    }
  }
  const { lower = null, middle = null, stddev = null, upper = null } = boll ?? {};
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
