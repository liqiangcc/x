"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  assertExecutionProfileTimelineReader,
} = require("../../ports/simulation/execution_profile_timeline_reader");
const {
  normalizeExecutionProfileRevisions,
} = require("../../simulation/execution/execution_profile_revision");
const {
  findCoverageGaps,
  normalizeRange,
} = require("../../simulation/execution/execution_assumption_timeline");

const EXECUTION_PROFILE_MANIFEST_SCHEMA_VERSION = 1;
const DEFAULT_EXECUTION_PROFILE_MANIFEST_PATH = path.join(
  "execution_profiles",
  "manifest.json"
);

function objectValue(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object.`);
  }
  return value;
}

function nonEmptyText(value, field) {
  const text = String(value ?? "").trim();
  if (!text) throw new TypeError(`${field} must be a non-empty string.`);
  return text;
}

function resolveDataPath(dataRoot, relativePath, field = "path") {
  const root = path.resolve(dataRoot);
  const text = nonEmptyText(relativePath, field);
  if (path.isAbsolute(text)) {
    throw new TypeError(`${field} must be relative to dataRoot.`);
  }
  const resolved = path.resolve(root, text);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new TypeError(`${field} must stay within dataRoot.`);
  }
  return resolved;
}

function normalizeExecutionProfileManifest(value) {
  const manifest = objectValue(value, "execution profile manifest");
  if (manifest.schemaVersion !== EXECUTION_PROFILE_MANIFEST_SCHEMA_VERSION) {
    throw new TypeError(
      `execution profile manifest schemaVersion must be ${EXECUTION_PROFILE_MANIFEST_SCHEMA_VERSION}.`
    );
  }
  if (!Array.isArray(manifest.revisions)) {
    throw new TypeError("execution profile manifest revisions must be an array.");
  }
  return Object.freeze({
    schemaVersion: EXECUTION_PROFILE_MANIFEST_SCHEMA_VERSION,
    revisions: normalizeExecutionProfileRevisions(manifest.revisions),
  });
}

function snapshotSource({ manifestPath, available, revisions }) {
  const profileIds = Object.freeze([
    ...new Set(revisions.map((revision) => revision.profileId)),
  ].sort());
  return Object.freeze({
    kind: "repo_execution_profile_revisions",
    manifestPath,
    schemaVersion: EXECUTION_PROFILE_MANIFEST_SCHEMA_VERSION,
    available,
    revisionCount: revisions.length,
    profileIds,
  });
}

function readExecutionProfileManifestSnapshot({
  dataRoot = path.join("data"),
  manifestPath = DEFAULT_EXECUTION_PROFILE_MANIFEST_PATH,
} = {}) {
  const normalizedManifestPath = nonEmptyText(manifestPath, "manifestPath");
  const manifestFile = resolveDataPath(dataRoot, normalizedManifestPath, "manifestPath");
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      const revisions = Object.freeze([]);
      return Object.freeze({
        available: false,
        revisions,
        source: snapshotSource({
          manifestPath: normalizedManifestPath,
          available: false,
          revisions,
        }),
      });
    }
    throw error;
  }

  const manifest = normalizeExecutionProfileManifest(payload);
  return Object.freeze({
    available: true,
    revisions: manifest.revisions,
    source: snapshotSource({
      manifestPath: normalizedManifestPath,
      available: true,
      revisions: manifest.revisions,
    }),
  });
}

function maxDate(left, right) {
  return left > right ? left : right;
}

function minDate(left, right) {
  return left < right ? left : right;
}

function clipRevision(revision, range) {
  const startDate = maxDate(revision.effectiveFrom, range.startDate);
  const revisionEnd = revision.effectiveTo ?? range.endDate;
  const endDate = minDate(revisionEnd, range.endDate);
  if (startDate > endDate) return null;
  return Object.freeze({ startDate, endDate, revision });
}

class LedgerExecutionProfileTimelineReader {
  constructor({
    dataRoot = path.join("data"),
    manifestPath = DEFAULT_EXECUTION_PROFILE_MANIFEST_PATH,
  } = {}) {
    this.dataRoot = path.resolve(dataRoot);
    this.manifestPath = manifestPath;
  }

  readTimeline({ profileId, startDate, endDate } = {}) {
    const normalizedProfileId = nonEmptyText(profileId, "profileId");
    const range = normalizeRange({ startDate, endDate });
    const snapshot = readExecutionProfileManifestSnapshot({
      dataRoot: this.dataRoot,
      manifestPath: this.manifestPath,
    });
    const segments = Object.freeze(snapshot.revisions
      .filter((revision) => revision.profileId === normalizedProfileId)
      .map((revision) => clipRevision(revision, range))
      .filter(Boolean));

    return Object.freeze({
      profileId: normalizedProfileId,
      startDate: range.startDate,
      endDate: range.endDate,
      segments,
      gaps: findCoverageGaps(segments, range),
      source: snapshot.source,
    });
  }
}

assertExecutionProfileTimelineReader(new LedgerExecutionProfileTimelineReader({
  dataRoot: path.join("__missing__"),
}));

module.exports = {
  DEFAULT_EXECUTION_PROFILE_MANIFEST_PATH,
  EXECUTION_PROFILE_MANIFEST_SCHEMA_VERSION,
  LedgerExecutionProfileTimelineReader,
  clipRevision,
  normalizeExecutionProfileManifest,
  readExecutionProfileManifestSnapshot,
  resolveDataPath,
};
