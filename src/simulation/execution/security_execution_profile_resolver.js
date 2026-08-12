"use strict";

const {
  assertSecurityExecutionProfileResolver,
} = require("../../ports/simulation/security_execution_profile_resolver");

const SECURITY_INSTRUMENT_TYPES = Object.freeze({
  A_SHARE: "a_share",
  ETF: "etf",
});

const SECURITY_EXECUTION_PROFILE_IDS = Object.freeze({
  A_SHARE: "legacy_a_share",
  DOMESTIC_STOCK_ETF: "domestic_stock_etf",
  T0_ETF: "t0_etf",
});

function normalizeSecurity(value) {
  const code = String(value?.code ?? "").trim();
  const market = Number(value?.market);
  if (!/^\d{6}$/.test(code)) throw new TypeError("security.code must be a six-digit code.");
  if (!Number.isInteger(market) || market < 0) {
    throw new TypeError("security.market must be a non-negative integer.");
  }
  return Object.freeze({ code, market });
}

function normalizeSecurityExecutionMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("securityMetadata must be an object.");
  }
  const instrumentType = String(value.instrumentType ?? "");
  if (!Object.values(SECURITY_INSTRUMENT_TYPES).includes(instrumentType)) {
    throw new TypeError("securityMetadata.instrumentType must be one of: a_share, etf.");
  }

  const hasEligibility = Object.prototype.hasOwnProperty.call(value, "intradayRoundTripEligible");
  const intradayRoundTripEligible = hasEligibility ? value.intradayRoundTripEligible : null;
  if (hasEligibility && typeof intradayRoundTripEligible !== "boolean") {
    throw new TypeError("securityMetadata.intradayRoundTripEligible must be a boolean when provided.");
  }

  if (instrumentType === SECURITY_INSTRUMENT_TYPES.A_SHARE && intradayRoundTripEligible === true) {
    throw new TypeError("a_share metadata cannot declare intradayRoundTripEligible=true for the supported execution profiles.");
  }
  if (instrumentType === SECURITY_INSTRUMENT_TYPES.ETF && typeof intradayRoundTripEligible !== "boolean") {
    throw new TypeError("ETF security metadata must explicitly declare intradayRoundTripEligible.");
  }

  return Object.freeze({
    instrumentType,
    intradayRoundTripEligible: instrumentType === SECURITY_INSTRUMENT_TYPES.A_SHARE
      ? false
      : intradayRoundTripEligible,
  });
}

function createSecurityExecutionProfileResolver() {
  return assertSecurityExecutionProfileResolver(Object.freeze({
    resolve({ security, metadata } = {}) {
      normalizeSecurity(security);
      const normalizedMetadata = normalizeSecurityExecutionMetadata(metadata);
      if (normalizedMetadata.instrumentType === SECURITY_INSTRUMENT_TYPES.A_SHARE) {
        return SECURITY_EXECUTION_PROFILE_IDS.A_SHARE;
      }
      return normalizedMetadata.intradayRoundTripEligible
        ? SECURITY_EXECUTION_PROFILE_IDS.T0_ETF
        : SECURITY_EXECUTION_PROFILE_IDS.DOMESTIC_STOCK_ETF;
    },
  }));
}

module.exports = {
  SECURITY_EXECUTION_PROFILE_IDS,
  SECURITY_INSTRUMENT_TYPES,
  createSecurityExecutionProfileResolver,
  normalizeSecurity,
  normalizeSecurityExecutionMetadata,
};
