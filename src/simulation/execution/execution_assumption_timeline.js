"use strict";

const {
  normalizeExecutionProfileRevision,
  normalizeRevisionIsoDate,
} = require("./execution_profile_revision");

function requiredText(value, field) {
  const text = String(value ?? "").trim();
  if (!text) throw new TypeError(`${field} must be a non-empty string.`);
  return text;
}

function compareSegments(left, right) {
  return left.startDate.localeCompare(right.startDate)
    || left.endDate.localeCompare(right.endDate);
}

function shiftIsoDate(value, days) {
  const normalized = normalizeRevisionIsoDate(value, "date");
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function maxDate(...values) {
  return values.reduce((maximum, value) => (value > maximum ? value : maximum));
}

function minDate(...values) {
  return values.reduce((minimum, value) => (value < minimum ? value : minimum));
}

function normalizeRange({ startDate, endDate } = {}) {
  const normalizedStart = normalizeRevisionIsoDate(startDate, "startDate");
  const normalizedEnd = normalizeRevisionIsoDate(endDate, "endDate");
  if (normalizedEnd < normalizedStart) {
    throw new TypeError("endDate must not be earlier than startDate.");
  }
  return Object.freeze({ startDate: normalizedStart, endDate: normalizedEnd });
}

function normalizeProfileFamilySegments(value) {
  if (!Array.isArray(value)) throw new TypeError("profileSegments must be an array.");
  const segments = value.map((segment, index) => {
    if (!segment || typeof segment !== "object" || Array.isArray(segment)) {
      throw new TypeError(`profileSegments[${index}] must be an object.`);
    }
    const startDate = normalizeRevisionIsoDate(
      segment.startDate,
      `profileSegments[${index}].startDate`
    );
    const endDate = normalizeRevisionIsoDate(
      segment.endDate,
      `profileSegments[${index}].endDate`
    );
    if (endDate < startDate) {
      throw new TypeError(`profileSegments[${index}].endDate must not be earlier than startDate.`);
    }
    return Object.freeze({
      startDate,
      endDate,
      profileId: requiredText(segment.profileId, `profileSegments[${index}].profileId`),
    });
  }).sort(compareSegments);

  for (let index = 1; index < segments.length; index += 1) {
    if (segments[index].startDate <= segments[index - 1].endDate) {
      throw new TypeError("profileSegments must not overlap.");
    }
  }
  return Object.freeze(segments);
}

function normalizeRevisionTimelineSegments(value) {
  if (!Array.isArray(value)) throw new TypeError("revisionSegments must be an array.");
  const segments = value.map((segment, index) => {
    if (!segment || typeof segment !== "object" || Array.isArray(segment)) {
      throw new TypeError(`revisionSegments[${index}] must be an object.`);
    }
    const startDate = normalizeRevisionIsoDate(
      segment.startDate,
      `revisionSegments[${index}].startDate`
    );
    const endDate = normalizeRevisionIsoDate(
      segment.endDate,
      `revisionSegments[${index}].endDate`
    );
    if (endDate < startDate) {
      throw new TypeError(`revisionSegments[${index}].endDate must not be earlier than startDate.`);
    }
    const revision = normalizeExecutionProfileRevision(segment.revision);
    if (startDate < revision.effectiveFrom) {
      throw new TypeError(
        `revisionSegments[${index}].startDate is before revision effectiveFrom.`
      );
    }
    if (revision.effectiveTo !== null && endDate > revision.effectiveTo) {
      throw new TypeError(
        `revisionSegments[${index}].endDate is after revision effectiveTo.`
      );
    }
    return Object.freeze({ startDate, endDate, revision });
  }).sort((left, right) => (
    left.revision.profileId.localeCompare(right.revision.profileId)
    || compareSegments(left, right)
  ));

  const previousByProfile = new Map();
  for (const segment of segments) {
    const profileId = segment.revision.profileId;
    const previous = previousByProfile.get(profileId);
    if (previous && segment.startDate <= previous.endDate) {
      throw new TypeError(
        `revisionSegments must not overlap for profileId ${profileId}.`
      );
    }
    previousByProfile.set(profileId, segment);
  }
  return Object.freeze(segments);
}

function findCoverageGaps(segments, range) {
  const clipped = segments
    .map((segment) => ({
      startDate: maxDate(segment.startDate, range.startDate),
      endDate: minDate(segment.endDate, range.endDate),
    }))
    .filter((segment) => segment.startDate <= segment.endDate)
    .sort(compareSegments);

  const gaps = [];
  let cursor = range.startDate;
  for (const segment of clipped) {
    if (segment.startDate > cursor) {
      gaps.push(Object.freeze({
        startDate: cursor,
        endDate: shiftIsoDate(segment.startDate, -1),
      }));
    }
    if (segment.endDate >= cursor) cursor = shiftIsoDate(segment.endDate, 1);
    if (cursor > range.endDate) break;
  }
  if (cursor <= range.endDate) {
    gaps.push(Object.freeze({ startDate: cursor, endDate: range.endDate }));
  }
  return Object.freeze(gaps);
}

function mergeQualityIssues(revision) {
  return Object.freeze([
    ...new Set([
      ...(revision.profile.qualityIssues ?? []),
      ...(revision.qualityIssues ?? []),
    ]),
  ].sort());
}

function intersectExecutionAssumptionTimelines({
  startDate,
  endDate,
  profileSegments = [],
  revisionSegments = [],
} = {}) {
  const range = normalizeRange({ startDate, endDate });
  const normalizedProfiles = normalizeProfileFamilySegments(profileSegments);
  const normalizedRevisions = normalizeRevisionTimelineSegments(revisionSegments);
  const intersections = [];

  for (const profileSegment of normalizedProfiles) {
    for (const revisionSegment of normalizedRevisions) {
      const revision = revisionSegment.revision;
      if (revision.profileId !== profileSegment.profileId) continue;
      const intersectionStart = maxDate(
        range.startDate,
        profileSegment.startDate,
        revisionSegment.startDate
      );
      const intersectionEnd = minDate(
        range.endDate,
        profileSegment.endDate,
        revisionSegment.endDate
      );
      if (intersectionStart > intersectionEnd) continue;
      intersections.push(Object.freeze({
        startDate: intersectionStart,
        endDate: intersectionEnd,
        profileId: revision.profileId,
        revisionId: revision.revisionId,
        executionProfile: revision.profile,
        source: revision.source,
        qualityIssues: mergeQualityIssues(revision),
      }));
    }
  }

  intersections.sort(compareSegments);
  for (let index = 1; index < intersections.length; index += 1) {
    if (intersections[index].startDate <= intersections[index - 1].endDate) {
      throw new TypeError("execution assumption intersections must not overlap.");
    }
  }

  const segments = Object.freeze(intersections);
  return Object.freeze({
    startDate: range.startDate,
    endDate: range.endDate,
    segments,
    gaps: findCoverageGaps(segments, range),
  });
}

module.exports = {
  findCoverageGaps,
  intersectExecutionAssumptionTimelines,
  mergeQualityIssues,
  normalizeProfileFamilySegments,
  normalizeRange,
  normalizeRevisionTimelineSegments,
  shiftIsoDate,
};
