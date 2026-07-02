"use strict";

const { numberAtPath } = require("./utils");

function marginPct(current, threshold) {
  if (!Number.isFinite(current) || !Number.isFinite(threshold) || threshold === 0) {
    return null;
  }
  return ((current - threshold) / Math.abs(threshold)) * 100;
}

function evaluateRatioCompare(context, params = {}) {
  const current = numberAtPath(context, params.current);
  const baseline = numberAtPath(context, params.baseline);
  const ratio = Number(params.ratio ?? 1);
  const threshold = Number.isFinite(baseline) && Number.isFinite(ratio) ? baseline * ratio : null;
  const evidence = {
    baseline_value: baseline,
    current_value: current,
    margin_pct: marginPct(current, threshold),
    ratio,
    threshold_value: threshold,
  };

  if (![current, baseline, threshold].every(Number.isFinite)) {
    return {
      evidence,
      ok: false,
      qualityIssues: [params.qualityIssue ?? "insufficient_history"],
    };
  }

  return {
    evidence,
    ok: current >= threshold,
    qualityIssues: [],
  };
}

module.exports = {
  evaluateRatioCompare,
};
