"use strict";

const {
  assertBuyExecutionModelResolver,
  normalizeBuyExecutionModelId,
} = require("../../ports/simulation/buy_execution_model_resolver");
const {
  assertBuyExecutionModelProvider,
} = require("../../ports/simulation/buy_execution_model_provider");
const {
  resolveNextExecutionBar,
} = require("./execution_model_support");

function normalizeIsoDate(value, field = "date") {
  const normalized = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new TypeError(`${field} must be an ISO date.`);
  }
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new TypeError(`${field} must be a valid ISO date.`);
  }
  return normalized;
}

function normalizeRevisionId(value, field) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new TypeError(`${field} must be a non-empty string.`);
  }
  return normalized;
}

function normalizeTimelineSegments(segments) {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new TypeError("segments must be a non-empty array.");
  }
  let previousEnd = null;
  return Object.freeze(segments.map((segment, index) => {
    const startDate = normalizeIsoDate(segment?.startDate, `segments[${index}].startDate`);
    const endDate = normalizeIsoDate(segment?.endDate, `segments[${index}].endDate`);
    if (endDate < startDate) {
      throw new TypeError(`segments[${index}].endDate must not be earlier than startDate.`);
    }
    if (previousEnd !== null && startDate <= previousEnd) {
      throw new TypeError("segments must be strictly ordered and non-overlapping.");
    }
    previousEnd = endDate;

    const hasRevisionId = segment?.revisionId !== undefined && segment?.revisionId !== null;
    const hasExecutionProfile =
      segment?.executionProfile !== undefined && segment?.executionProfile !== null;
    if (hasRevisionId !== hasExecutionProfile) {
      throw new TypeError(
        `segments[${index}] must provide revisionId and executionProfile together.`
      );
    }

    const normalized = {
      startDate,
      endDate,
      profileId: normalizeBuyExecutionModelId(segment?.profileId),
    };
    if (hasRevisionId) {
      if (typeof segment.executionProfile !== "object" || Array.isArray(segment.executionProfile)) {
        throw new TypeError(`segments[${index}].executionProfile must be an object.`);
      }
      normalized.revisionId = normalizeRevisionId(
        segment.revisionId,
        `segments[${index}].revisionId`
      );
      normalized.executionProfile = segment.executionProfile;
    }
    return Object.freeze(normalized);
  }));
}

function findTimelineSegment(segments, date) {
  const normalizedDate = normalizeIsoDate(date, "date");
  const segment = segments.find(
    (candidate) => candidate.startDate <= normalizedDate && candidate.endDate >= normalizedDate
  );
  if (!segment) {
    throw new Error(`execution profile timeline does not cover ${normalizedDate}.`);
  }
  return segment;
}

function executionModelCacheKey(segment) {
  if (!segment.revisionId) return segment.profileId;
  return JSON.stringify([segment.profileId, segment.revisionId]);
}

class TimelineBuyExecutionModelProvider {
  constructor({
    segments,
    executionModelResolver,
    executionConfig = {},
  } = {}) {
    this.segments = normalizeTimelineSegments(segments);
    this.executionModelResolver = assertBuyExecutionModelResolver(executionModelResolver);
    if (!executionConfig || typeof executionConfig !== "object" || Array.isArray(executionConfig)) {
      throw new TypeError("executionConfig must be an object.");
    }
    this.executionConfig = Object.freeze({ ...executionConfig });
    this.models = new Map();
    assertBuyExecutionModelProvider(this);
  }

  resolveForBuy({ bars, signalDate } = {}) {
    const timing = resolveNextExecutionBar(bars, signalDate);
    const effectiveDate = timing.bar?.date ?? timing.signalDate;
    const segment = findTimelineSegment(this.segments, effectiveDate);
    const cacheKey = executionModelCacheKey(segment);
    if (!this.models.has(cacheKey)) {
      const request = {
        model: segment.profileId,
        executionConfig: this.executionConfig,
      };
      if (segment.executionProfile) {
        request.executionProfile = segment.executionProfile;
        request.assumptionRevisionId = segment.revisionId;
      }
      this.models.set(cacheKey, this.executionModelResolver.resolve(request));
    }
    return this.models.get(cacheKey);
  }
}

module.exports = {
  TimelineBuyExecutionModelProvider,
  findTimelineSegment,
  normalizeIsoDate,
  normalizeTimelineSegments,
};