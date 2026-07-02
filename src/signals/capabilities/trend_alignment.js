"use strict";

const { numberAtPath } = require("./utils");

function evaluateTrendAlignment(context, params = {}) {
  const paths = Array.isArray(params.paths) ? params.paths : [];
  const values = paths.map((path) => numberAtPath(context, path));
  const evidence = Object.fromEntries(paths.map((path, index) => [path, values[index]]));

  if (values.length < 2 || !values.every(Number.isFinite)) {
    return {
      evidence,
      ok: false,
      qualityIssues: [params.qualityIssue ?? "insufficient_history"],
    };
  }

  const ok = values.every((value, index) => index === 0 || values[index - 1] > value);
  return {
    evidence,
    ok,
    qualityIssues: [],
  };
}

module.exports = {
  evaluateTrendAlignment,
};
