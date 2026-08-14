"use strict";

const { normalizeDate } = require("../../core/date");
const {
  defineExecutionProfile,
} = require("../../ports/simulation/execution_profile");

function requiredText(value, field) {
  const text = String(value ?? "").trim();
  if (!text) throw new TypeError(`${field} must be a non-empty string.`);
  return text;
}

function normalizeRevisionIsoDate(value, field, { nullable = false } = {}) {
  if ((value === null || value === undefined || value === "") && nullable) return null;
  let compact;
  try {
    compact = normalizeDate(value);
  } catch {
    throw new TypeError(`${field} must be a valid YYYY-MM-DD or YYYYMMDD date.`);
  }
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
}

function normalizeCollectedAt(value) {
  const text = requiredText(value, "source.collectedAt");
  const parsed = new Date(text);
  if (!Number.isFinite(parsed.getTime())) {
    throw new TypeError("source.collectedAt must be a valid date-time.");
  }
  return parsed.toISOString();
}

function normalizeRevisionSource(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("executionProfileRevision.source must be an object.");
  }
  return Object.freeze({
    provider: requiredText(value.provider, "source.provider"),
    document: requiredText(value.document, "source.document"),
    version: requiredText(value.version, "source.version"),
    collectedAt: normalizeCollectedAt(value.collectedAt),
  });
}

function normalizeRevisionQualityIssues(value = []) {
  if (!Array.isArray(value)) {
    throw new TypeError("executionProfileRevision.qualityIssues must be an array.");
  }
  return Object.freeze([
    ...new Set(value.map((issue) => requiredText(issue, "qualityIssues[]"))),
  ].sort());
}

function normalizeExecutionProfileRevision(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("executionProfileRevision must be an object.");
  }

  const profileId = requiredText(value.profileId, "executionProfileRevision.profileId");
  const revisionId = requiredText(value.revisionId, "executionProfileRevision.revisionId");
  const effectiveFrom = normalizeRevisionIsoDate(value.effectiveFrom, "effectiveFrom");
  const effectiveTo = normalizeRevisionIsoDate(
    value.effectiveTo,
    "effectiveTo",
    { nullable: true }
  );
  if (effectiveTo !== null && effectiveTo < effectiveFrom) {
    throw new TypeError("effectiveTo must not be earlier than effectiveFrom.");
  }

  const profile = defineExecutionProfile(value.profile);
  if (profile.id !== profileId) {
    throw new TypeError(
      "executionProfileRevision.profile.id must match executionProfileRevision.profileId."
    );
  }

  return Object.freeze({
    revisionId,
    profileId,
    effectiveFrom,
    effectiveTo,
    profile,
    source: normalizeRevisionSource(value.source),
    qualityIssues: normalizeRevisionQualityIssues(value.qualityIssues),
  });
}

function normalizeExecutionProfileRevisions(value) {
  if (!Array.isArray(value)) {
    throw new TypeError("executionProfileRevisions must be an array.");
  }

  const normalized = value.map(normalizeExecutionProfileRevision);
  const revisionIds = new Set();
  const grouped = new Map();

  for (const revision of normalized) {
    if (revisionIds.has(revision.revisionId)) {
      throw new TypeError(`duplicate execution profile revisionId: ${revision.revisionId}.`);
    }
    revisionIds.add(revision.revisionId);
    const group = grouped.get(revision.profileId) ?? [];
    group.push(revision);
    grouped.set(revision.profileId, group);
  }

  for (const [profileId, revisions] of grouped) {
    revisions.sort((left, right) => (
      left.effectiveFrom.localeCompare(right.effectiveFrom)
      || left.revisionId.localeCompare(right.revisionId)
    ));
    for (let index = 1; index < revisions.length; index += 1) {
      const previous = revisions[index - 1];
      const current = revisions[index];
      if (previous.effectiveTo === null || current.effectiveFrom <= previous.effectiveTo) {
        throw new TypeError(
          `execution profile revisions must not overlap for profileId ${profileId}.`
        );
      }
    }
  }

  return Object.freeze([...normalized].sort((left, right) => (
    left.profileId.localeCompare(right.profileId)
    || left.effectiveFrom.localeCompare(right.effectiveFrom)
    || left.revisionId.localeCompare(right.revisionId)
  )));
}

function isExecutionProfileRevisionEffective(revision, asOfDate) {
  const normalizedRevision = normalizeExecutionProfileRevision(revision);
  const normalizedAsOfDate = normalizeRevisionIsoDate(asOfDate, "asOfDate");
  return normalizedRevision.effectiveFrom <= normalizedAsOfDate
    && (
      normalizedRevision.effectiveTo === null
      || normalizedAsOfDate <= normalizedRevision.effectiveTo
    );
}

module.exports = {
  isExecutionProfileRevisionEffective,
  normalizeExecutionProfileRevision,
  normalizeExecutionProfileRevisions,
  normalizeRevisionIsoDate,
  normalizeRevisionQualityIssues,
  normalizeRevisionSource,
};
