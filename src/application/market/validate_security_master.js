"use strict";

const {
  securityIdentityKey,
} = require("../../market/security_execution_metadata");
const {
  normalizeSecurityMasterRecord,
} = require("../../market/security_master_record");
const {
  validateSecurityMasterEntries,
} = require("../../market/security_master_quality_validator");
const {
  assertSecurityMasterSnapshotReader,
} = require("../../ports/market/security_master_reader");
const {
  assertSecurityExecutionProfileResolver,
} = require("../../ports/simulation/security_execution_profile_resolver");

function freezeIssue(issue) {
  const normalized = { ...issue };
  if (Array.isArray(normalized.entryIndexes)) {
    normalized.entryIndexes = Object.freeze([...normalized.entryIndexes]);
  }
  return Object.freeze(normalized);
}

function emptySummary() {
  return Object.freeze({
    recordCount: 0,
    validRecordCount: 0,
    invalidRecordCount: 0,
    securityCount: 0,
    errorCount: 1,
    warningCount: 0,
    profileResolutionCount: 0,
    profileResolutionErrorCount: 0,
  });
}

function singleIssueReport({ code, message, source = null }) {
  const issue = freezeIssue({
    severity: "error",
    code,
    message,
    entryIndexes: [],
  });
  return Object.freeze({
    ok: false,
    issues: Object.freeze([issue]),
    summary: emptySummary(),
    meta: Object.freeze({ source }),
  });
}

function failedLoadReport(error) {
  return singleIssueReport({
    code: "security_master_snapshot_load_failed",
    message: error.message,
  });
}

class ValidateSecurityMasterUseCase {
  constructor({
    securityMasterSnapshotReader,
    securityExecutionProfileResolver,
    validate = validateSecurityMasterEntries,
  } = {}) {
    this.securityMasterSnapshotReader = assertSecurityMasterSnapshotReader(
      securityMasterSnapshotReader
    );
    this.securityExecutionProfileResolver = assertSecurityExecutionProfileResolver(
      securityExecutionProfileResolver
    );
    if (typeof validate !== "function") {
      throw new TypeError("validate must be a function.");
    }
    this.validate = validate;
  }

  async execute() {
    let snapshot;
    try {
      snapshot = await this.securityMasterSnapshotReader.readSnapshot();
    } catch (error) {
      return failedLoadReport(error);
    }

    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
      return failedLoadReport(new TypeError("security master snapshot must be an object."));
    }
    if (snapshot.available !== true) {
      return singleIssueReport({
        code: "security_master_unavailable",
        message: "Security master manifest is unavailable.",
        source: snapshot.source ?? null,
      });
    }
    if (!Array.isArray(snapshot.entries)) {
      return failedLoadReport(new TypeError("security master snapshot entries must be an array."));
    }
    if (snapshot.entries.length === 0) {
      return singleIssueReport({
        code: "security_master_empty",
        message: "Security master contains no auditable records.",
        source: snapshot.source ?? null,
      });
    }

    const entries = snapshot.entries;
    const base = this.validate(entries);
    const issues = [...base.issues];
    let profileResolutionCount = 0;
    let profileResolutionErrorCount = 0;

    entries.forEach((entry, index) => {
      let record;
      try {
        record = normalizeSecurityMasterRecord(entry?.record ?? entry);
      } catch {
        return;
      }
      profileResolutionCount += 1;
      try {
        const profileId = this.securityExecutionProfileResolver.resolve({
          security: record.security,
          metadata: record,
        });
        if (typeof profileId !== "string" || profileId.trim() === "") {
          throw new TypeError("security execution profile resolver returned an empty profile id.");
        }
      } catch (error) {
        profileResolutionErrorCount += 1;
        const key = securityIdentityKey(record.security);
        issues.push(freezeIssue({
          severity: "error",
          code: "security_execution_profile_unresolvable",
          message: `Security ${key} cannot resolve an execution profile: ${error.message}`,
          securityKey: key,
          entryIndexes: [index],
        }));
      }
    });

    issues.sort((left, right) => {
      const severity = (left.severity === "error" ? 0 : 1) - (right.severity === "error" ? 0 : 1);
      if (severity !== 0) return severity;
      if (left.code !== right.code) return left.code.localeCompare(right.code);
      return (left.securityKey ?? "").localeCompare(right.securityKey ?? "");
    });
    const errorCount = issues.filter((issue) => issue.severity === "error").length;
    const warningCount = issues.length - errorCount;

    return Object.freeze({
      ok: errorCount === 0,
      issues: Object.freeze(issues),
      summary: Object.freeze({
        ...base.summary,
        errorCount,
        warningCount,
        profileResolutionCount,
        profileResolutionErrorCount,
      }),
      meta: Object.freeze({ source: snapshot.source ?? null }),
    });
  }
}

module.exports = {
  ValidateSecurityMasterUseCase,
  emptySummary,
  failedLoadReport,
  singleIssueReport,
};
