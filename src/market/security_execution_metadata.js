"use strict";

const SECURITY_INSTRUMENT_TYPES = Object.freeze({
  A_SHARE: "a_share",
  ETF: "etf",
});

function normalizeSecurityIdentity(value) {
  const code = String(value?.code ?? "").trim();
  const market = Number(value?.market);
  if (!/^\d{6}$/.test(code)) throw new TypeError("security.code must be a six-digit code.");
  if (!Number.isInteger(market) || market < 0) {
    throw new TypeError("security.market must be a non-negative integer.");
  }
  return Object.freeze({ code, market });
}

function securityIdentityKey(value) {
  const security = normalizeSecurityIdentity(value);
  return `${security.market}.${security.code}`;
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
    throw new TypeError(
      "a_share metadata cannot declare intradayRoundTripEligible=true for the supported execution profiles."
    );
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

module.exports = {
  SECURITY_INSTRUMENT_TYPES,
  normalizeSecurityExecutionMetadata,
  normalizeSecurityIdentity,
  securityIdentityKey,
};
