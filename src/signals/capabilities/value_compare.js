"use strict";

const { compareValues, marginPct, numberAtPath } = require("./utils");

function evaluateValueCompare(context, params = {}) {
  const left = numberAtPath(context, params.left);
  const right = numberAtPath(context, params.right);
  const operator = String(params.operator ?? "");
  const evidence = {
    left_path: params.left ?? null,
    left_value: left,
    margin_pct: marginPct(left, right),
    operator,
    right_path: params.right ?? null,
    right_value: right,
  };

  if (![left, right].every(Number.isFinite) || !["gt", "gte", "lt", "lte", "eq"].includes(operator)) {
    return {
      evidence,
      ok: false,
      qualityIssues: [params.qualityIssue ?? "invalid_feature_value"],
    };
  }

  return {
    evidence,
    ok: compareValues(left, right, operator),
    qualityIssues: [],
  };
}

module.exports = {
  evaluateValueCompare,
};
