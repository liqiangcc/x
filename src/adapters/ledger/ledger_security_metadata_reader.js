"use strict";

const {
  assertSecurityMetadataReader,
} = require("../../ports/market/security_metadata_reader");
const {
  assertSecurityMasterReader,
} = require("../../ports/market/security_master_reader");
const { LedgerSecurityMasterReader } = require("./ledger_security_master_reader");

class LedgerSecurityMetadataReader {
  constructor({ securityMasterReader = null, dataRoot = undefined } = {}) {
    this.securityMasterReader = assertSecurityMasterReader(
      securityMasterReader ?? new LedgerSecurityMasterReader(
        dataRoot === undefined ? {} : { dataRoot }
      )
    );
  }

  readMetadata(security, options = {}) {
    const record = this.securityMasterReader.readRecord(security, options);
    if (!record) return null;
    return Object.freeze({
      instrumentType: record.instrumentType,
      intradayRoundTripEligible: record.intradayRoundTripEligible,
      effectiveFrom: record.effectiveFrom,
      effectiveTo: record.effectiveTo,
      source: Object.freeze({
        kind: "security_master",
        ...record.source,
      }),
      qualityIssues: record.qualityIssues,
    });
  }
}

assertSecurityMetadataReader(new LedgerSecurityMetadataReader({
  securityMasterReader: { readRecord() { return null; } },
}));

module.exports = {
  LedgerSecurityMetadataReader,
};
