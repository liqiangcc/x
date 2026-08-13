"use strict";

const {
  normalizeSecurityIdentity,
} = require("../../market/security_execution_metadata");
const {
  normalizeIsoDate,
  normalizeSecurityMasterRecord,
} = require("../../market/security_master_record");
const {
  assertSecurityMasterTimelineReader,
} = require("../../ports/market/security_master_timeline_reader");
const {
  assertSecurityExecutionProfileResolver,
} = require("../../ports/simulation/security_execution_profile_resolver");

function normalizeRequest({ security, startDate, endDate } = {}) {
  const normalizedSecurity = normalizeSecurityIdentity(security);
  const normalizedStart = normalizeIsoDate(startDate, "startDate");
  const normalizedEnd = normalizeIsoDate(endDate, "endDate");
  if (normalizedEnd < normalizedStart) {
    throw new TypeError("endDate must not be earlier than startDate.");
  }
  return Object.freeze({
    security: normalizedSecurity,
    startDate: normalizedStart,
    endDate: normalizedEnd,
  });
}

function nextIsoDate(value) {
  const normalized = normalizeIsoDate(value, "date");
  const date = new Date(`${normalized}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function projectMetadata(record) {
  const normalized = normalizeSecurityMasterRecord(record);
  return Object.freeze({
    instrumentType: normalized.instrumentType,
    intradayRoundTripEligible: normalized.intradayRoundTripEligible,
    effectiveFrom: normalized.effectiveFrom,
    effectiveTo: normalized.effectiveTo,
    source: Object.freeze({
      kind: "security_master",
      ...normalized.source,
    }),
    qualityIssues: normalized.qualityIssues,
  });
}

function describeGaps(gaps) {
  return gaps
    .map((gap) => `${String(gap.startDate)}..${String(gap.endDate)}`)
    .join(", ");
}

function normalizeSegments(segments) {
  return segments.map((segment) => {
    const startDate = normalizeIsoDate(segment?.startDate, "segments[].startDate");
    const endDate = normalizeIsoDate(segment?.endDate, "segments[].endDate");
    if (endDate < startDate) {
      throw new TypeError("segments[].endDate must not be earlier than segments[].startDate.");
    }
    return Object.freeze({
      startDate,
      endDate,
      record: normalizeSecurityMasterRecord(segment?.record),
    });
  });
}

function assertCompleteCoverage(segments, { startDate, endDate }) {
  let expectedStart = startDate;
  for (const segment of segments) {
    if (segment.startDate !== expectedStart) {
      throw new Error(
        `security master timeline is not continuous at ${expectedStart}; next segment starts at ${segment.startDate}.`
      );
    }
    if (segment.endDate > endDate) {
      throw new Error(
        `security master timeline extends beyond requested endDate ${endDate}.`
      );
    }
    if (segment.endDate === endDate) {
      expectedStart = null;
      continue;
    }
    expectedStart = nextIsoDate(segment.endDate);
  }
  if (expectedStart !== null) {
    throw new Error(
      `security master timeline is not continuous through requested endDate ${endDate}.`
    );
  }
}

class ResolveExecutionProfileTimelineUseCase {
  constructor({
    securityMasterTimelineReader,
    securityExecutionProfileResolver,
  } = {}) {
    this.securityMasterTimelineReader = assertSecurityMasterTimelineReader(
      securityMasterTimelineReader
    );
    this.securityExecutionProfileResolver = assertSecurityExecutionProfileResolver(
      securityExecutionProfileResolver
    );
  }

  async execute(request = {}) {
    const normalized = normalizeRequest(request);
    const timeline = await this.securityMasterTimelineReader.readTimeline(
      normalized.security,
      {
        startDate: normalized.startDate,
        endDate: normalized.endDate,
      }
    );

    if (!timeline || typeof timeline !== "object" || Array.isArray(timeline)) {
      throw new TypeError("securityMasterTimelineReader must return an object.");
    }
    const segments = Array.isArray(timeline.segments) ? timeline.segments : [];
    const gaps = Array.isArray(timeline.gaps) ? timeline.gaps : [];
    if (gaps.length > 0) {
      throw new Error(
        `security master timeline does not fully cover the requested interval: ${describeGaps(gaps)}`
      );
    }
    if (segments.length === 0) {
      throw new Error("security master timeline has no records for the requested interval.");
    }

    const normalizedSegments = normalizeSegments(segments);
    assertCompleteCoverage(normalizedSegments, normalized);

    const resolvedSegments = normalizedSegments.map((segment) => {
      const metadata = projectMetadata(segment.record);
      const profileId = this.securityExecutionProfileResolver.resolve({
        security: normalized.security,
        metadata,
      });
      return Object.freeze({
        startDate: segment.startDate,
        endDate: segment.endDate,
        profileId,
        metadata,
      });
    });

    return Object.freeze({
      security: normalized.security,
      startDate: normalized.startDate,
      endDate: normalized.endDate,
      segments: Object.freeze(resolvedSegments),
      source: timeline.source ?? null,
    });
  }
}

module.exports = {
  ResolveExecutionProfileTimelineUseCase,
  assertCompleteCoverage,
  nextIsoDate,
  normalizeRequest,
  normalizeSegments,
  projectMetadata,
};
