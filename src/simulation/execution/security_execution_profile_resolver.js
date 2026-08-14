"use strict";

const {
  SECURITY_INSTRUMENT_TYPES,
  normalizeSecurityExecutionMetadata,
  normalizeSecurityIdentity,
} = require("../../market/security_execution_metadata");
const {
  assertSecurityExecutionProfileResolver,
} = require("../../ports/simulation/security_execution_profile_resolver");

const SECURITY_EXECUTION_PROFILE_IDS = Object.freeze({
  A_SHARE: "legacy_a_share",
  DOMESTIC_STOCK_ETF: "domestic_stock_etf",
  T0_ETF: "t0_etf",
});

function createSecurityExecutionProfileResolver() {
  return assertSecurityExecutionProfileResolver(Object.freeze({
    resolve({ security, metadata } = {}) {
      normalizeSecurityIdentity(security);
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
  normalizeSecurity: normalizeSecurityIdentity,
  normalizeSecurityExecutionMetadata,
};
