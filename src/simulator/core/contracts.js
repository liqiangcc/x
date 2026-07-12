"use strict";

const SECURITY_CODE_PATTERN = /^\d{6}$/;

function assertNonEmptyString(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function assertPositiveInteger(value, field) {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(`${field} must be a positive integer.`);
  }
  return value;
}

function normalizeSecurityId(input = {}) {
  const code = String(input.code ?? "").trim();
  const market = Number(input.market);
  if (!SECURITY_CODE_PATTERN.test(code)) {
    throw new TypeError("code must be a six-digit security code.");
  }
  if (!Number.isInteger(market) || market < 0) {
    throw new TypeError("market must be a non-negative integer.");
  }
  return Object.freeze({ code, market });
}

function securityKey(input) {
  const { code, market } = normalizeSecurityId(input);
  return `${market}.${code}`;
}

module.exports = {
  assertNonEmptyString,
  assertPositiveInteger,
  normalizeSecurityId,
  securityKey,
};
