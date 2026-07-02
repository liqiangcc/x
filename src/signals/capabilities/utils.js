"use strict";

function getPathValue(source, dottedPath) {
  return String(dottedPath ?? "")
    .split(".")
    .filter(Boolean)
    .reduce((value, key) => value?.[key], source);
}

function numberAtPath(context, path) {
  const value = getPathValue(context, path);
  return Number.isFinite(value) ? value : null;
}

function compareValues(left, right, operator) {
  if (![left, right].every(Number.isFinite)) {
    return false;
  }
  if (operator === "gt") {
    return left > right;
  }
  if (operator === "gte") {
    return left >= right;
  }
  if (operator === "lt") {
    return left < right;
  }
  if (operator === "lte") {
    return left <= right;
  }
  if (operator === "eq") {
    return left === right;
  }
  return false;
}

function marginPct(current, baseline) {
  if (!Number.isFinite(current) || !Number.isFinite(baseline) || baseline === 0) {
    return null;
  }
  return ((current - baseline) / Math.abs(baseline)) * 100;
}

module.exports = {
  compareValues,
  getPathValue,
  marginPct,
  numberAtPath,
};
