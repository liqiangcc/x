"use strict";

const { compareValues, getPathValue } = require("./utils");

const COMPARATORS = new Set(["gt", "gte", "lt", "lte", "eq"]);
const ORDERS = new Set(["earliest", "latest"]);

function numberFromField(row, field) {
  const value = getPathValue(row, field);
  return Number.isFinite(value) ? value : null;
}

function selectPoints(source, order, pointCount) {
  if (order === "earliest") {
    return source.slice(0, pointCount);
  }
  return source.slice(source.length - pointCount);
}

function pointEvidence(point, field, index) {
  return {
    date: point?.date ?? null,
    index,
    value: numberFromField(point, field),
    year: point?.year ?? null,
  };
}

function evaluateSequencePattern(context, params = {}) {
  const source = getPathValue(context, params.source);
  const field = String(params.field ?? "");
  const order = String(params.order ?? "latest");
  const transitions = Number(params.transitions);
  const comparator = String(params.comparator ?? "");
  const pointCount = transitions + 1;
  const evidence = {
    comparator,
    field,
    order,
    points: [],
    source: params.source ?? null,
    transitions,
  };

  if (
    !Array.isArray(source) ||
    !field ||
    !Number.isInteger(transitions) ||
    transitions < 1 ||
    !COMPARATORS.has(comparator) ||
    !ORDERS.has(order)
  ) {
    return {
      evidence,
      ok: false,
      qualityIssues: [params.qualityIssue ?? "invalid_feature_value"],
    };
  }

  if (source.length < pointCount) {
    return {
      evidence: {
        ...evidence,
        available_points: source.length,
        required_points: pointCount,
      },
      ok: false,
      qualityIssues: [params.qualityIssue ?? "insufficient_history"],
    };
  }

  const selected = selectPoints(source, order, pointCount);
  const points = selected.map((point, index) => pointEvidence(point, field, index));
  const comparisons = points.slice(1).map((point, index) => {
    const previous = points[index];
    return {
      left_index: point.index,
      left_value: point.value,
      ok: compareValues(point.value, previous.value, comparator),
      operator: comparator,
      right_index: previous.index,
      right_value: previous.value,
    };
  });
  const invalidPoint = points.some((point) => !Number.isFinite(point.value));

  if (invalidPoint) {
    return {
      evidence: {
        ...evidence,
        comparisons,
        points,
      },
      ok: false,
      qualityIssues: ["invalid_feature_value"],
    };
  }

  return {
    evidence: {
      ...evidence,
      comparisons,
      points,
    },
    ok: comparisons.every((comparison) => comparison.ok),
    qualityIssues: [],
  };
}

module.exports = {
  evaluateSequencePattern,
};
