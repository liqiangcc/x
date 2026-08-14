"use strict";

const {
  assertSecurityMasterWriter,
} = require("../../ports/market/security_master_writer");

function requiredText(value, field) {
  const text = String(value ?? "").trim();
  if (!text) throw new TypeError(`${field} must be a non-empty string.`);
  return text;
}

function normalizeRecords(value) {
  if (!Array.isArray(value)) {
    throw new TypeError("records must be an array.");
  }
  return value;
}

class DryRunSecurityMasterWriter {
  constructor() {
    this.writeIntents = [];
  }

  async writeRecords({ datasetId, records, metadata = null } = {}) {
    const normalizedDatasetId = requiredText(datasetId, "datasetId");
    const normalizedRecords = normalizeRecords(records);
    const intent = Object.freeze({
      dryRun: true,
      datasetId: normalizedDatasetId,
      recordCount: normalizedRecords.length,
      metadata,
    });
    this.writeIntents.push(intent);
    return intent;
  }
}

assertSecurityMasterWriter(new DryRunSecurityMasterWriter());

module.exports = {
  DryRunSecurityMasterWriter,
};
