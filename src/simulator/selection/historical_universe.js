"use strict";

const EXCLUDED_STATUSES = new Set([
  "st",
  "*st",
  "special_treatment",
  "delisting",
  "delisting_consolidation",
]);

function normalizeStatus(value) {
  return String(value ?? "").trim().toLowerCase().replaceAll(" ", "_");
}

function filterHistoricalUniverse(universe, { excludeSpecialTreatment = true } = {}) {
  const included = [];
  const excluded = [];
  let missingStatusCount = 0;

  for (const security of universe?.securities ?? []) {
    const status = normalizeStatus(security.status);
    if (!status) missingStatusCount += 1;
    if (excludeSpecialTreatment && status && EXCLUDED_STATUSES.has(status)) {
      excluded.push({ security, reason: "special_treatment_or_delisting" });
    } else {
      included.push(security);
    }
  }

  const qualityIssues = [...(universe?.qualityIssues ?? [])];
  if (missingStatusCount > 0) qualityIssues.push("security_status_unavailable");
  return {
    ...universe,
    excluded,
    missingStatusCount,
    qualityIssues: [...new Set(qualityIssues)].sort(),
    securities: included,
  };
}

class HistoricalUniverse {
  constructor({ repository }) {
    if (!repository || typeof repository.listAvailableCodes !== "function") {
      throw new TypeError("HistoricalUniverse requires a universe repository.");
    }
    this.repository = repository;
  }

  async list(options) {
    return filterHistoricalUniverse(
      await this.repository.listAvailableCodes({ asOfDate: options.asOfDate }),
      options,
    );
  }
}

module.exports = {
  EXCLUDED_STATUSES,
  HistoricalUniverse,
  filterHistoricalUniverse,
  normalizeStatus,
};
