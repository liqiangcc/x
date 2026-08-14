"use strict";

const {
  assertBuyExecutionModelResolver,
  normalizeBuyExecutionModelId,
} = require("../../ports/simulation/buy_execution_model_resolver");
const {
  assertBuyExecutionModelProvider,
} = require("../../ports/simulation/buy_execution_model_provider");

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
    return Object.freeze({
      startDate,
      endDate,
      profileId: normalizeBuyExecutionModelId(segment?.profileId),
    });
  }));
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

  resolveForDate({ date } = {}) {
    const normalizedDate = normalizeIsoDate(date, "date");
    const segment = this.segments.find(
      (candidate) => candidate.startDate <= normalizedDate && candidate.endDate >= normalizedDate
    );
    if (!segment) {
      throw new Error(`execution profile timeline does not cover ${normalizedDate}.`);
    }
    if (!this.models.has(segment.profileId)) {
      this.models.set(segment.profileId, this.executionModelResolver.resolve({
        model: segment.profileId,
        executionConfig: this.executionConfig,
      }));
    }
    return this.models.get(segment.profileId);
  }
}

module.exports = {
  TimelineBuyExecutionModelProvider,
  normalizeIsoDate,
  normalizeTimelineSegments,
};
