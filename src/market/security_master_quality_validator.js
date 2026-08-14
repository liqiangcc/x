"use strict";

const {
  securityIdentityKey,
} = require("./security_execution_metadata");
const {
  normalizeSecurityMasterRecord,
} = require("./security_master_record");

const ISSUE_SEVERITIES = Object.freeze({
  ERROR: "error",
  WARNING: "warning",
});

function normalizeEntry(value, index) {
  const envelope = value && typeof value === "object" && !Array.isArray(value)
    && Object.hasOwn(value, "record")
    ? value
    : { record: value };
  const record = normalizeSecurityMasterRecord(envelope.record);
  const priority = envelope.priority === undefined ? 0 : Number(envelope.priority);
  if (!Number.isInteger(priority) || priority < 0) {
    throw new TypeError("security master entry priority must be a non-negative integer.");
  }
  return Object.freeze({
    index,
    priority,
    origin: envelope.origin ?? null,
    record,
  });
}

function rangesOverlap(left, right) {
  const leftEnd = left.effectiveTo ?? "9999-12-31";
  const rightEnd = right.effectiveTo ?? "9999-12-31";
  return left.effectiveFrom <= rightEnd && right.effectiveFrom <= leftEnd;
}

function sameFact(left, right) {
  return left.instrumentType === right.instrumentType
    && left.intradayRoundTripEligible === right.intradayRoundTripEligible;
}

function sameWindow(left, right) {
  return left.effectiveFrom === right.effectiveFrom
    && left.effectiveTo === right.effectiveTo;
}

function freezeIssue(issue) {
  const normalized = { ...issue };
  if (Array.isArray(normalized.entryIndexes)) {
    normalized.entryIndexes = Object.freeze([...normalized.entryIndexes]);
  }
  return Object.freeze(normalized);
}

function issueSort(left, right) {
  const severityRank = { error: 0, warning: 1 };
  const severity = severityRank[left.severity] - severityRank[right.severity];
  if (severity !== 0) return severity;
  if (left.code !== right.code) return left.code.localeCompare(right.code);
  const leftKey = left.securityKey ?? "";
  const rightKey = right.securityKey ?? "";
  if (leftKey !== rightKey) return leftKey.localeCompare(rightKey);
  return (left.entryIndexes?.[0] ?? -1) - (right.entryIndexes?.[0] ?? -1);
}

function overlapIssue(left, right) {
  const securityKey = securityIdentityKey(left.record.security);
  const entryIndexes = [left.index, right.index];

  if (!sameFact(left.record, right.record)) {
    return freezeIssue({
      severity: ISSUE_SEVERITIES.ERROR,
      code: "conflicting_security_fact_overlap",
      message: `Security ${securityKey} has overlapping validity windows with conflicting execution facts.`,
      securityKey,
      entryIndexes,
    });
  }

  if (sameWindow(left.record, right.record)) {
    const samePriority = left.priority === right.priority;
    return freezeIssue({
      severity: samePriority ? ISSUE_SEVERITIES.ERROR : ISSUE_SEVERITIES.WARNING,
      code: samePriority
        ? "duplicate_security_fact_window"
        : "shadowed_security_fact_window",
      message: samePriority
        ? `Security ${securityKey} repeats the same fact for the same validity window at the same priority.`
        : `Security ${securityKey} repeats the same fact window across precedence levels.`,
      securityKey,
      entryIndexes,
    });
  }

  const samePriority = left.priority === right.priority;
  return freezeIssue({
    severity: samePriority ? ISSUE_SEVERITIES.ERROR : ISSUE_SEVERITIES.WARNING,
    code: samePriority
      ? "overlapping_security_fact_windows"
      : "shadowed_security_fact_overlap",
    message: samePriority
      ? `Security ${securityKey} has overlapping validity windows at the same priority.`
      : `Security ${securityKey} has overlapping equivalent facts across precedence levels.`,
    securityKey,
    entryIndexes,
  });
}

function validateSecurityMasterEntries(entries) {
  if (!Array.isArray(entries)) {
    throw new TypeError("security master entries must be an array.");
  }

  const issues = [];
  const normalized = [];
  entries.forEach((entry, index) => {
    try {
      normalized.push(normalizeEntry(entry, index));
    } catch (error) {
      issues.push(freezeIssue({
        severity: ISSUE_SEVERITIES.ERROR,
        code: "invalid_security_master_record",
        message: error.message,
        entryIndexes: [index],
      }));
    }
  });

  const bySecurity = new Map();
  for (const entry of normalized) {
    const key = securityIdentityKey(entry.record.security);
    const values = bySecurity.get(key) ?? [];
    values.push(entry);
    bySecurity.set(key, values);
  }

  for (const values of bySecurity.values()) {
    values.sort((left, right) => {
      if (left.record.effectiveFrom !== right.record.effectiveFrom) {
        return left.record.effectiveFrom.localeCompare(right.record.effectiveFrom);
      }
      return left.index - right.index;
    });
    for (let leftIndex = 0; leftIndex < values.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < values.length; rightIndex += 1) {
        const left = values[leftIndex];
        const right = values[rightIndex];
        if (!rangesOverlap(left.record, right.record)) continue;
        issues.push(overlapIssue(left, right));
      }
    }
  }

  issues.sort(issueSort);
  const errorCount = issues.filter((issue) => issue.severity === ISSUE_SEVERITIES.ERROR).length;
  const warningCount = issues.length - errorCount;

  return Object.freeze({
    ok: errorCount === 0,
    issues: Object.freeze(issues),
    summary: Object.freeze({
      recordCount: entries.length,
      validRecordCount: normalized.length,
      invalidRecordCount: entries.length - normalized.length,
      securityCount: bySecurity.size,
      errorCount,
      warningCount,
    }),
  });
}

module.exports = {
  ISSUE_SEVERITIES,
  normalizeEntry,
  rangesOverlap,
  sameFact,
  sameWindow,
  validateSecurityMasterEntries,
};
