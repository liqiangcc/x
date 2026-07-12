"use strict";

const { DataMode } = require("../core/enums");
const { createDataManifest } = require("./data_manifest");

const APPROXIMATION_ISSUES = Object.freeze([
  "historical_fee_rules_unavailable",
  "historical_security_status_unavailable",
  "market_rule_approximation",
  "point_in_time_adjustment_unavailable",
  "raw_execution_price_unavailable",
]);

function unique(values) {
  return [...new Set((values ?? []).filter(Boolean))].sort();
}

function candidateIssues({ dailyHistory, yearlyHistory }) {
  const issues = [];
  if ((yearlyHistory?.bars?.length ?? 0) < 4) issues.push("insufficient_completed_years");
  if ((dailyHistory?.bars?.length ?? 0) < 2) issues.push("insufficient_current_year_history");
  issues.push(...(dailyHistory?.qualityIssues ?? []), ...(yearlyHistory?.qualityIssues ?? []));
  return unique(issues);
}

function executionIssues(input) {
  if (input?.executionEligible !== true) {
    return unique(input?.qualityIssues?.length ? input.qualityIssues : ["invalid_execution_price"]);
  }
  return unique(input?.qualityIssues);
}

function evaluateMvpDataGate({
  asOfDate,
  universe,
  candidateInputs = [],
  executionInputs = [],
  manifestInputs = [],
}) {
  const blockingIssues = [];
  const qualityIssues = [
    ...APPROXIMATION_ISSUES,
    ...(universe?.qualityIssues ?? []),
  ];
  if ((universe?.securities?.length ?? 0) === 0) blockingIssues.push("missing_available_universe");

  const candidates = candidateInputs.map((input) => {
    const issues = candidateIssues(input);
    return { candidateId: input.candidateId ?? null, eligible: issues.length === 0, issues };
  });
  const executions = executionInputs.map((input) => {
    const issues = executionIssues(input);
    if (issues.length > 0) blockingIssues.push(...issues);
    return { orderId: input.orderId ?? null, eligible: issues.length === 0, issues };
  });

  const manifest = createDataManifest({ asOfDate, universe, inputs: manifestInputs });
  return {
    ok: blockingIssues.length === 0,
    dataMode: DataMode.LEGACY_APPROXIMATE,
    blockingIssues: unique(blockingIssues),
    qualityIssues: unique(qualityIssues),
    candidates,
    executions,
    manifest,
  };
}

module.exports = {
  APPROXIMATION_ISSUES,
  candidateIssues,
  evaluateMvpDataGate,
  executionIssues,
};
