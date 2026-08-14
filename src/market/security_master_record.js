"use strict";

const {
  normalizeSecurityExecutionMetadata,
  normalizeSecurityIdentity,
} = require("./security_execution_metadata");

function normalizeIsoDate(value, field, { nullable = false } = {}) {
  if ((value === null || value === undefined || value === "") && nullable) return null;
  const text = String(value ?? "").trim();
  const match = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(text);
  if (!match) throw new TypeError(`${field} must be YYYY-MM-DD or YYYYMMDD.`);
  const normalized = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new TypeError(`${field} must be a valid calendar date.`);
  }
  return normalized;
}

function requiredText(value, field) {
  const text = String(value ?? "").trim();
  if (!text) throw new TypeError(`${field} must be a non-empty string.`);
  return text;
}

function normalizeCollectedAt(value) {
  const text = requiredText(value, "source.collectedAt");
  const parsed = new Date(text);
  if (!Number.isFinite(parsed.getTime())) {
    throw new TypeError("source.collectedAt must be a valid date-time.");
  }
  return parsed.toISOString();
}

function normalizeSource(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("source must be an object.");
  }
  return Object.freeze({
    provider: requiredText(value.provider, "source.provider"),
    document: requiredText(value.document, "source.document"),
    version: requiredText(value.version, "source.version"),
    collectedAt: normalizeCollectedAt(value.collectedAt),
  });
}

function normalizeQualityIssues(value = []) {
  if (!Array.isArray(value)) throw new TypeError("qualityIssues must be an array.");
  const issues = value.map((item) => requiredText(item, "qualityIssues[]"));
  return Object.freeze([...new Set(issues)].sort());
}

function normalizeSecurityMasterRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("securityMasterRecord must be an object.");
  }
  const security = normalizeSecurityIdentity(value.security);
  const executionMetadata = normalizeSecurityExecutionMetadata(value);
  if (typeof value.intradayRoundTripEligible !== "boolean") {
    throw new TypeError("securityMasterRecord.intradayRoundTripEligible must be an explicit boolean.");
  }
  const effectiveFrom = normalizeIsoDate(value.effectiveFrom, "effectiveFrom");
  const effectiveTo = normalizeIsoDate(value.effectiveTo, "effectiveTo", { nullable: true });
  if (effectiveTo !== null && effectiveTo < effectiveFrom) {
    throw new TypeError("effectiveTo must not be earlier than effectiveFrom.");
  }

  return Object.freeze({
    security,
    instrumentType: executionMetadata.instrumentType,
    intradayRoundTripEligible: executionMetadata.intradayRoundTripEligible,
    effectiveFrom,
    effectiveTo,
    source: normalizeSource(value.source),
    qualityIssues: normalizeQualityIssues(value.qualityIssues),
  });
}

function isSecurityMasterRecordEffective(record, asOf) {
  const normalizedRecord = normalizeSecurityMasterRecord(record);
  const normalizedAsOf = normalizeIsoDate(asOf, "asOf");
  return normalizedRecord.effectiveFrom <= normalizedAsOf
    && (normalizedRecord.effectiveTo === null || normalizedAsOf <= normalizedRecord.effectiveTo);
}

module.exports = {
  isSecurityMasterRecordEffective,
  normalizeCollectedAt,
  normalizeIsoDate,
  normalizeQualityIssues,
  normalizeSecurityMasterRecord,
  normalizeSource,
};
