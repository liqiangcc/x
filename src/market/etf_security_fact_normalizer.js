"use strict";

const {
  normalizeIsoDate,
  normalizeSecurityMasterRecord,
} = require("./security_master_record");
const {
  normalizeSecurityIdentity,
} = require("./security_execution_metadata");

const OFFICIAL_EXCHANGES = Object.freeze({
  SSE: "sse",
  SZSE: "szse",
});

function requiredText(value, field) {
  const text = String(value ?? "").trim();
  if (!text) throw new TypeError(`${field} must be a non-empty string.`);
  return text;
}

function normalizeExchange(value) {
  const exchange = requiredText(value, "exchange").toLowerCase();
  if (!Object.values(OFFICIAL_EXCHANGES).includes(exchange)) {
    throw new TypeError(`unsupported ETF exchange: ${exchange}`);
  }
  return exchange;
}

function normalizeProvenance(value, exchange) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("provenance must be an object.");
  }
  const provider = requiredText(value.provider ?? exchange, "provenance.provider").toLowerCase();
  if (provider !== exchange) {
    throw new TypeError("provenance.provider must match exchange.");
  }
  return {
    provider,
    document: requiredText(value.document, "provenance.document"),
    version: requiredText(value.version, "provenance.version"),
    collectedAt: requiredText(value.collectedAt, "provenance.collectedAt"),
  };
}

function normalizeEtfSecurityFact(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("ETF security fact must be an object.");
  }
  const exchange = normalizeExchange(value.exchange);
  const security = normalizeSecurityIdentity(value.security);
  if (typeof value.intradayRoundTripEligible !== "boolean") {
    throw new TypeError("ETF fact intradayRoundTripEligible must be an explicit boolean.");
  }
  const effectiveFrom = normalizeIsoDate(value.effectiveFrom, "effectiveFrom");
  const provenance = normalizeProvenance(value.provenance, exchange);
  const qualityIssues = Array.isArray(value.qualityIssues) ? value.qualityIssues : [];

  return normalizeSecurityMasterRecord({
    security,
    instrumentType: "etf",
    intradayRoundTripEligible: value.intradayRoundTripEligible,
    effectiveFrom,
    effectiveTo: value.effectiveTo ?? null,
    source: provenance,
    qualityIssues,
  });
}

module.exports = {
  OFFICIAL_EXCHANGES,
  normalizeEtfSecurityFact,
  normalizeExchange,
  normalizeProvenance,
};
