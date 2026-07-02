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

module.exports = {
  getPathValue,
  numberAtPath,
};
