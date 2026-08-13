"use strict";

const {
  normalizeSecurityIdentity,
  securityIdentityKey,
} = require("../../market/security_execution_metadata");
const {
  isSecurityMasterRecordEffective,
  normalizeIsoDate,
} = require("../../market/security_master_record");
const {
  assertSecurityMasterSnapshotReader,
} = require("../../ports/market/security_master_reader");
const {
  assertSecurityMasterTimelineReader,
} = require("../../ports/market/security_master_timeline_reader");

function shiftIsoDate(value, days) {
  const normalized = normalizeIsoDate(value, "date");
  const date = new Date(`${normalized}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function nextIsoDate(value) {
  return shiftIsoDate(value, 1);
}

function previousIsoDate(value) {
  return shiftIsoDate(value, -1);
}

function intersects(record, startDate, endDate) {
  return record.effectiveFrom <= endDate
    && (record.effectiveTo === null || record.effectiveTo >= startDate);
}

function appendRange(target, range, sameValue) {
  const previous = target[target.length - 1];
  if (
    previous
    && sameValue(previous, range)
    && nextIsoDate(previous.endDate) === range.startDate
  ) {
    target[target.length - 1] = Object.freeze({
      ...previous,
      endDate: range.endDate,
    });
    return;
  }
  target.push(Object.freeze(range));
}

class LedgerSecurityMasterTimelineReader {
  constructor({ securityMasterSnapshotReader } = {}) {
    this.securityMasterSnapshotReader = assertSecurityMasterSnapshotReader(
      securityMasterSnapshotReader
    );
  }

  readTimeline(value, { startDate, endDate } = {}) {
    const security = normalizeSecurityIdentity(value);
    const normalizedStart = normalizeIsoDate(startDate, "startDate");
    const normalizedEnd = normalizeIsoDate(endDate, "endDate");
    if (normalizedEnd < normalizedStart) {
      throw new TypeError("endDate must not be earlier than startDate.");
    }

    const snapshot = this.securityMasterSnapshotReader.readSnapshot();
    const key = securityIdentityKey(security);
    const entries = (Array.isArray(snapshot?.entries) ? snapshot.entries : [])
      .filter((entry) => entry?.record && securityIdentityKey(entry.record.security) === key)
      .filter(({ record }) => intersects(record, normalizedStart, normalizedEnd));

    const boundaries = new Set([normalizedStart]);
    for (const { record } of entries) {
      if (record.effectiveFrom > normalizedStart && record.effectiveFrom <= normalizedEnd) {
        boundaries.add(record.effectiveFrom);
      }
      if (
        record.effectiveTo !== null
        && record.effectiveTo >= normalizedStart
        && record.effectiveTo < normalizedEnd
      ) {
        boundaries.add(nextIsoDate(record.effectiveTo));
      }
    }

    const orderedBoundaries = [...boundaries].sort();
    const segments = [];
    const gaps = [];

    for (let index = 0; index < orderedBoundaries.length; index += 1) {
      const rangeStart = orderedBoundaries[index];
      const nextBoundary = orderedBoundaries[index + 1] ?? null;
      const rangeEnd = nextBoundary ? previousIsoDate(nextBoundary) : normalizedEnd;
      if (rangeStart > normalizedEnd || rangeEnd < normalizedStart) continue;

      const winner = entries.find(({ record }) =>
        isSecurityMasterRecordEffective(record, rangeStart)
      );

      if (!winner) {
        appendRange(gaps, {
          startDate: rangeStart,
          endDate: rangeEnd,
        }, () => true);
        continue;
      }

      appendRange(segments, {
        startDate: rangeStart,
        endDate: rangeEnd,
        record: winner.record,
      }, (previous, current) => previous.record === current.record);
    }

    return Object.freeze({
      security,
      startDate: normalizedStart,
      endDate: normalizedEnd,
      segments: Object.freeze(segments),
      gaps: Object.freeze(gaps),
      source: snapshot?.source ?? null,
    });
  }
}

assertSecurityMasterTimelineReader(new LedgerSecurityMasterTimelineReader({
  securityMasterSnapshotReader: {
    readSnapshot() {
      return { entries: [], source: null };
    },
  },
}));

module.exports = {
  LedgerSecurityMasterTimelineReader,
  nextIsoDate,
  previousIsoDate,
  shiftIsoDate,
};
