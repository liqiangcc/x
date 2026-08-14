"use strict";

const { normalizeDate } = require("../../core/date");

function normalizeStrategyId(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > 128) {
    throw new TypeError("strategyId must be a non-empty string up to 128 characters.");
  }
  return normalized;
}

function normalizeOptionalIsoDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = normalizeDate(value);
  return `${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(6, 8)}`;
}

function normalizeRequiredIsoDate(value) {
  const normalized = normalizeOptionalIsoDate(value);
  if (!normalized) throw new TypeError("date is required.");
  return normalized;
}

function normalizeSecurityKey(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > 160) {
    throw new TypeError("securityKey must be a non-empty string up to 160 characters.");
  }
  return normalized;
}

module.exports = {
  normalizeOptionalIsoDate,
  normalizeRequiredIsoDate,
  normalizeSecurityKey,
  normalizeStrategyId,
};
