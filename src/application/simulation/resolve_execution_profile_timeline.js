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

    const resolvedSegments = segments.map((segment) => {
      const startDate = normalizeIsoDate(segment?.startDate, "segments[].startDate");
      const endDate = normalizeIsoDate(segment?.endDate, "segments[].endDate");
      if (endDate < startDate) {
        throw new TypeError("segments[].endDate must not be earlier than segments[].startDate.");
      }
      const metadata = projectMetadata(segment?.record);
      const profileId = this.securityExecutionProfileResolver.resolve({
        security: normalized.security,
        metadata,
      });
      return Object.freeze({
        startDate,
        endDate,
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
  normalizeRequest,
  projectMetadata,
};
