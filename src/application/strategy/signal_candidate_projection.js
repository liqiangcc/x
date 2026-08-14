"use strict";

function projectSignalCandidate(candidate, { includeEvidence = false } = {}) {
  const item = {
    rank: Number.isInteger(candidate?.rank) ? candidate.rank : null,
    securityKey: String(candidate?.securityKey ?? ""),
    code: String(candidate?.code ?? ""),
    market: Number.isInteger(candidate?.market) ? candidate.market : Number(candidate?.market),
    rankingValues: Array.isArray(candidate?.rankingValues)
      ? candidate.rankingValues.map((value) => Number.isFinite(value) ? value : null)
      : [],
    qualityIssues: [...new Set((candidate?.qualityIssues ?? []).filter(Boolean))].sort(),
  };
  if (includeEvidence) {
    item.evidence = candidate?.evidence && typeof candidate.evidence === "object"
      ? candidate.evidence
      : {};
  }
  return item;
}

module.exports = {
  projectSignalCandidate,
};
