"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  normalizeSecurityMasterRecord,
} = require("../../market/security_master_record");
const {
  assertSecurityMasterWriter,
} = require("../../ports/market/security_master_writer");

const SECURITY_MASTER_SCHEMA_VERSION = 1;
const RECORD_FILE_KIND = "record_file";

function requiredText(value, field) {
  const text = String(value ?? "").trim();
  if (!text) throw new TypeError(`${field} must be a non-empty string.`);
  return text;
}

function normalizeDatasetId(value) {
  const datasetId = requiredText(value, "datasetId");
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(datasetId)) {
    throw new TypeError("datasetId must contain only lowercase letters, digits, '_' or '-'.");
  }
  return datasetId;
}

function objectValue(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object.`);
  }
  return value;
}

function writeJsonAtomic(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

class LedgerSecurityMasterWriter {
  constructor({
    dataRoot = path.join("data"),
    manifestPath = path.join("security_master", "manifest.json"),
    recordsDir = path.join("security_master", "records"),
  } = {}) {
    this.dataRoot = path.resolve(dataRoot);
    this.manifestPath = manifestPath;
    this.recordsDir = recordsDir;
  }

  #resolveDataPath(relativePath, field) {
    const text = requiredText(relativePath, field);
    if (path.isAbsolute(text)) throw new TypeError(`${field} must be relative to dataRoot.`);
    const resolved = path.resolve(this.dataRoot, text);
    if (resolved !== this.dataRoot && !resolved.startsWith(`${this.dataRoot}${path.sep}`)) {
      throw new TypeError(`${field} must stay within dataRoot.`);
    }
    return resolved;
  }

  writeRecords({ datasetId, records, metadata = null } = {}) {
    const normalizedDatasetId = normalizeDatasetId(datasetId);
    if (!Array.isArray(records)) throw new TypeError("records must be an array.");
    const normalizedRecords = records.map((record) => normalizeSecurityMasterRecord(record));
    const relativeRecordPath = path.join(this.recordsDir, `${normalizedDatasetId}.json`)
      .split(path.sep)
      .join("/");
    const recordFile = this.#resolveDataPath(relativeRecordPath, "record file path");
    const manifestFile = this.#resolveDataPath(this.manifestPath, "manifestPath");

    let manifest;
    try {
      manifest = objectValue(JSON.parse(fs.readFileSync(manifestFile, "utf8")), "security master manifest");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      manifest = { schemaVersion: SECURITY_MASTER_SCHEMA_VERSION, recordSets: [], records: [] };
    }
    if (manifest.schemaVersion !== SECURITY_MASTER_SCHEMA_VERSION) {
      throw new TypeError(`security master schemaVersion must be ${SECURITY_MASTER_SCHEMA_VERSION}.`);
    }
    if (!Array.isArray(manifest.recordSets)) throw new TypeError("recordSets must be an array.");
    if (!Array.isArray(manifest.records)) throw new TypeError("records must be an array.");

    const recordSet = {
      kind: RECORD_FILE_KIND,
      path: relativeRecordPath,
    };
    const matching = manifest.recordSets.filter(
      (item) => item?.kind === RECORD_FILE_KIND && item?.path === relativeRecordPath
    );
    if (matching.length > 1) {
      throw new TypeError(`security master manifest contains duplicate record_file entries for ${relativeRecordPath}.`);
    }
    const nextRecordSets = matching.length === 1
      ? manifest.recordSets
      : [...manifest.recordSets, recordSet];

    writeJsonAtomic(recordFile, {
      schemaVersion: SECURITY_MASTER_SCHEMA_VERSION,
      datasetId: normalizedDatasetId,
      metadata,
      records: normalizedRecords,
    });
    writeJsonAtomic(manifestFile, {
      ...manifest,
      recordSets: nextRecordSets,
    });

    return Object.freeze({
      datasetId: normalizedDatasetId,
      path: relativeRecordPath,
      recordCount: normalizedRecords.length,
    });
  }
}

assertSecurityMasterWriter(new LedgerSecurityMasterWriter({ dataRoot: "__missing__" }));

module.exports = {
  LedgerSecurityMasterWriter,
  RECORD_FILE_KIND,
  SECURITY_MASTER_SCHEMA_VERSION,
  normalizeDatasetId,
  writeJsonAtomic,
};
