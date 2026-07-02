"use strict";

function evaluateQualityGate(context, params = {}) {
  const blockedIssues = new Set(params.blockedIssues ?? []);
  const issues = Array.isArray(context?.quality?.issues) ? context.quality.issues : [];
  const matchedIssues = issues.filter((issue) => blockedIssues.has(issue));
  return {
    evidence: {
      blocked_issues: [...blockedIssues],
      matched_issues: matchedIssues,
    },
    ok: matchedIssues.length === 0,
    qualityIssues: matchedIssues,
  };
}

module.exports = {
  evaluateQualityGate,
};
