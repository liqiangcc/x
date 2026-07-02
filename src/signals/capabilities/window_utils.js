"use strict";

const { getPathValue } = require("./utils");

function pointValue(row, field) {
  const value = getPathValue(row, field);
  return Number.isFinite(value) ? value : null;
}

function pointEvidence(row, field, index) {
  return {
    date: row?.date ?? null,
    index,
    value: pointValue(row, field),
    year: row?.year ?? null,
  };
}

function windowBaseEvidence(params = {}) {
  return {
    anchor_field: params.anchorField ?? "date",
    anchor_path: params.anchorPath ?? null,
    anchor_value: null,
    field: params.field ?? null,
    include_anchor: params.includeAnchor === true,
    points: [],
    size: Number(params.size),
    source: params.source ?? null,
  };
}

function selectWindow(context, params = {}) {
  const source = getPathValue(context, params.source);
  const field = String(params.field ?? "");
  const size = Number(params.size);
  const includeAnchor = params.includeAnchor === true;
  const anchorField = String(params.anchorField ?? "date");
  const evidence = windowBaseEvidence(params);

  if (!Array.isArray(source) || !field || !Number.isInteger(size) || size < 1) {
    return {
      evidence,
      ok: false,
      qualityIssues: [params.qualityIssue ?? "invalid_feature_value"],
      rows: [],
    };
  }

  let endExclusive = source.length;
  if (params.anchorPath) {
    const anchorValue = getPathValue(context, params.anchorPath);
    const anchorIndex = source.findIndex((row) => getPathValue(row, anchorField) === anchorValue);
    evidence.anchor_value = anchorValue ?? null;
    if (anchorIndex < 0) {
      return {
        evidence: {
          ...evidence,
          available_points: source.length,
          required_points: size,
        },
        ok: false,
        qualityIssues: [params.qualityIssue ?? "insufficient_history"],
        rows: [],
      };
    }
    endExclusive = includeAnchor ? anchorIndex + 1 : anchorIndex;
  }

  const start = endExclusive - size;
  if (start < 0) {
    return {
      evidence: {
        ...evidence,
        available_points: Math.max(endExclusive, 0),
        required_points: size,
      },
      ok: false,
      qualityIssues: [params.qualityIssue ?? "insufficient_history"],
      rows: [],
    };
  }

  const rows = source.slice(start, endExclusive);
  const points = rows.map((row, index) => pointEvidence(row, field, start + index));
  if (points.some((point) => !Number.isFinite(point.value))) {
    return {
      evidence: {
        ...evidence,
        points,
      },
      ok: false,
      qualityIssues: [params.qualityIssue ?? "invalid_feature_value"],
      rows: [],
    };
  }

  return {
    evidence: {
      ...evidence,
      points,
      window_end: points.at(-1)?.date ?? null,
      window_start: points[0]?.date ?? null,
    },
    ok: true,
    qualityIssues: [],
    rows,
    values: points.map((point) => point.value),
  };
}

module.exports = {
  selectWindow,
};
