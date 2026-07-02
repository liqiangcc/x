"use strict";

const { numberAtPath } = require("./utils");

function marginPct(current, baseline) {
  if (!Number.isFinite(current) || !Number.isFinite(baseline) || baseline === 0) {
    return null;
  }
  return ((current - baseline) / Math.abs(baseline)) * 100;
}

function evaluateFirstCross(context, params = {}) {
  const current = numberAtPath(context, params.current);
  const previous = numberAtPath(context, params.previous);
  const baseline = numberAtPath(context, params.baseline);
  const evidence = {
    baseline_value: baseline,
    current_value: current,
    margin_pct: marginPct(current, baseline),
    previous_value: previous,
  };

  if (![current, previous, baseline].every(Number.isFinite)) {
    return {
      evidence,
      ok: false,
      qualityIssues: params.qualityIssue === false ? [] : [params.qualityIssue ?? "invalid_feature_value"],
    };
  }

  return {
    evidence,
    ok: previous <= baseline && current > baseline,
    qualityIssues: [],
  };
}

module.exports = {
  evaluateFirstCross,
};
