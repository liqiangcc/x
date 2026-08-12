"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  normalizeSecurityIdentity,
  securityIdentityKey,
} = require("../../market/security_execution_metadata");
const {
  isSecurityMasterRecordEffective,
  normalizeIsoDate,
  normalizeSecurityMasterRecord,
} = require("../../market/security_master_record");
const {
  assertSecurityMasterReader,
  assertSecurityMasterSnapshotReader,
} = require("../../ports/market/security_master_reader");

const SECURITY_MASTER_SCHEMA_VERSION = 1;
const RECORD_SET_KINDS = Object.freeze({
  UNIVERSE_SNAPSHOT: "universe_snapshot",
});

function objectValue(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object.`);
  }
  return value;
}

function arrayValue(value, field) {
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array.`);
  return value;
}

function nonEmptyText(value, field) {
  const text = String(value ?? "").trim();
  if (!text) throw new TypeError(`${field} must be a non-empty string.`);
  return text;
}

function compareEntries(left, right) {
  if (left.priority !== right.priority) return right.priority - left.priority;
  if (left.record.effectiveFrom !== right.record.effectiveFrom) {
    return right.record.effectiveFrom.localeCompare(left.record.effectiveFrom);
  }
  const leftTo = left.record.effectiveTo ?? "9999-12-31";
  const rightTo = right.record.effectiveTo ?? "9999-12-31";
  return rightTo.localeCompare(leftTo);
}

function compareSnapshotEntries(left, right) {
  const leftKey = securityIdentityKey(left.record.security);
  const rightKey = securityIdentityKey(right.record.security);
  if (leftKey !== rightKey) return leftKey.localeCompare(rightKey);
  return compareEntries(left, right);
}

class LedgerSecurityMasterReader {
  constructor({
    dataRoot = path.join("data"),
    manifestPath = path.join("security_master", "manifest.json"),
  } = {}) {
    this.dataRoot = path.resolve(dataRoot);
    this.manifestPath = manifestPath;
    this.signature = null;
    this.available = false;
    this.records = new Map();
    this.snapshotSource = null;
  }

  #resolveDataPath(relativePath, field = "path") {
    const text = nonEmptyText(relativePath, field);
    if (path.isAbsolute(text)) throw new TypeError(`${field} must be relative to dataRoot.`);
    const resolved = path.resolve(this.dataRoot, text);
    if (resolved !== this.dataRoot && !resolved.startsWith(`${this.dataRoot}${path.sep}`)) {
      throw new TypeError(`${field} must stay within dataRoot.`);
    }
    return resolved;
  }

  #addRecord(target, record, priority, origin) {
    const normalized = normalizeSecurityMasterRecord(record);
    const key = securityIdentityKey(normalized.security);
    const existing = target.get(key) ?? [];
    existing.push(Object.freeze({
      record: normalized,
      priority,
      origin: Object.freeze({ ...origin }),
    }));
    existing.sort(compareEntries);
    target.set(key, existing);
  }

  #loadUniverseSnapshot(target, recordSet, index) {
    const definition = objectValue(recordSet, "recordSets[]");
    if (definition.kind !== RECORD_SET_KINDS.UNIVERSE_SNAPSHOT) {
      throw new TypeError(`unsupported security master record set kind: ${String(definition.kind)}`);
    }
    const classification = objectValue(definition.classification, "recordSets[].classification");
    const sourcePath = this.#resolveDataPath(definition.path, "recordSets[].path");
    const payload = objectValue(
      JSON.parse(fs.readFileSync(sourcePath, "utf8")),
      "universe snapshot"
    );
    const stocks = arrayValue(payload.stocks, "universe snapshot stocks");

    for (const stock of stocks) {
      const item = objectValue(stock, "universe snapshot stock");
      this.#addRecord(target, {
        security: {
          code: item.code,
          market: item.market_id,
        },
        instrumentType: classification.instrumentType,
        intradayRoundTripEligible: classification.intradayRoundTripEligible,
        effectiveFrom: definition.effectiveFrom,
        effectiveTo: definition.effectiveTo ?? null,
        source: definition.source,
        qualityIssues: definition.qualityIssues ?? [],
      }, 1, {
        kind: "record_set",
        index,
        recordSetKind: definition.kind,
        path: definition.path,
      });
    }
  }

  #refresh() {
    const manifestFile = this.#resolveDataPath(this.manifestPath, "manifestPath");
    let stat;
    try {
      stat = fs.statSync(manifestFile);
    } catch (error) {
      if (error?.code === "ENOENT") {
        this.signature = null;
        this.available = false;
        this.records = new Map();
        this.snapshotSource = Object.freeze({
          kind: "repo_security_master",
          manifestPath: this.manifestPath,
          schemaVersion: SECURITY_MASTER_SCHEMA_VERSION,
        });
        return;
      }
      throw error;
    }

    const signature = `${stat.mtimeMs}:${stat.size}`;
    if (signature === this.signature) return;

    const manifest = objectValue(JSON.parse(fs.readFileSync(manifestFile, "utf8")), "security master manifest");
    if (manifest.schemaVersion !== SECURITY_MASTER_SCHEMA_VERSION) {
      throw new TypeError(
        `security master schemaVersion must be ${SECURITY_MASTER_SCHEMA_VERSION}.`
      );
    }

    const recordSets = arrayValue(manifest.recordSets ?? [], "recordSets");
    const explicitRecords = arrayValue(manifest.records ?? [], "records");
    const next = new Map();
    recordSets.forEach((recordSet, index) => this.#loadUniverseSnapshot(next, recordSet, index));
    explicitRecords.forEach((record, index) => this.#addRecord(next, record, 2, {
      kind: "explicit_record",
      index,
    }));

    this.records = next;
    this.available = true;
    this.snapshotSource = Object.freeze({
      kind: "repo_security_master",
      manifestPath: this.manifestPath,
      schemaVersion: SECURITY_MASTER_SCHEMA_VERSION,
      recordSetCount: recordSets.length,
      explicitRecordCount: explicitRecords.length,
    });
    this.signature = signature;
  }

  readRecord(value, { asOf = null } = {}) {
    const security = normalizeSecurityIdentity(value);
    this.#refresh();
    const entries = this.records.get(securityIdentityKey(security)) ?? [];
    if (entries.length === 0) return null;
    if (asOf === null || asOf === undefined || asOf === "") {
      return entries[0].record;
    }

    const normalizedAsOf = normalizeIsoDate(asOf, "asOf");
    const entry = entries.find(({ record }) => isSecurityMasterRecordEffective(record, normalizedAsOf));
    return entry?.record ?? null;
  }

  readSnapshot() {
    this.#refresh();
    const entries = [...this.records.values()]
      .flat()
      .slice()
      .sort(compareSnapshotEntries);
    return Object.freeze({
      available: this.available,
      entries: Object.freeze(entries),
      source: this.snapshotSource,
    });
  }
}

assertSecurityMasterReader(new LedgerSecurityMasterReader({ dataRoot: path.join("__missing__") }));
assertSecurityMasterSnapshotReader(new LedgerSecurityMasterReader({ dataRoot: path.join("__missing__") }));

module.exports = {
  LedgerSecurityMasterReader,
  RECORD_SET_KINDS,
  SECURITY_MASTER_SCHEMA_VERSION,
  compareEntries,
  compareSnapshotEntries,
};
