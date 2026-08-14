"use strict";

const {
  normalizeSecurityMasterRecord,
} = require("../../market/security_master_record");
const {
  assertEtfSecuritySource,
} = require("../../ports/market/etf_security_source");
const {
  assertSecurityMasterWriter,
} = require("../../ports/market/security_master_writer");
const {
  assertSecurityExecutionProfileResolver,
} = require("../../ports/simulation/security_execution_profile_resolver");
const {
  ValidateSecurityMasterUseCase,
} = require("./validate_security_master");

function normalizeSourceResult(value, index) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`ETF source result ${index} must be an object.`);
  }
  const exchange = String(value.exchange ?? "").trim().toLowerCase();
  if (!exchange) throw new TypeError(`ETF source result ${index} exchange is required.`);
  if (!Array.isArray(value.records)) {
    throw new TypeError(`ETF source result ${index} records must be an array.`);
  }
  return Object.freeze({
    exchange,
    records: Object.freeze(value.records.map((record) => normalizeSecurityMasterRecord(record))),
    source: value.source ?? null,
    summary: value.summary ?? null,
  });
}

class SyncEtfSecurityMasterUseCase {
  constructor({
    sources,
    securityMasterWriter,
    securityExecutionProfileResolver,
  } = {}) {
    if (!Array.isArray(sources) || sources.length === 0) {
      throw new TypeError("sources must be a non-empty array.");
    }
    this.sources = sources.map((source) => assertEtfSecuritySource(source));
    this.securityMasterWriter = assertSecurityMasterWriter(securityMasterWriter);
    this.securityExecutionProfileResolver = assertSecurityExecutionProfileResolver(
      securityExecutionProfileResolver
    );
  }

  async execute() {
    const sourceResults = [];
    const exchanges = new Set();
    for (let index = 0; index < this.sources.length; index += 1) {
      const result = normalizeSourceResult(await this.sources[index].fetchFacts(), index);
      if (exchanges.has(result.exchange)) {
        throw new TypeError(`duplicate ETF source exchange: ${result.exchange}`);
      }
      exchanges.add(result.exchange);
      sourceResults.push(result);
    }

    const entries = sourceResults.flatMap((result) =>
      result.records.map((record) => ({
        record,
        priority: 2,
        origin: { kind: "etf_source", exchange: result.exchange },
      }))
    );

    const validation = await new ValidateSecurityMasterUseCase({
      securityMasterSnapshotReader: {
        readSnapshot() {
          return {
            available: true,
            entries,
            source: { kind: "etf_security_source_sync" },
          };
        },
      },
      securityExecutionProfileResolver: this.securityExecutionProfileResolver,
    }).execute();

    if (!validation.ok) {
      return Object.freeze({
        ok: false,
        validation,
        writes: Object.freeze([]),
      });
    }

    const writes = [];
    for (const result of sourceResults) {
      writes.push(await this.securityMasterWriter.writeRecords({
        datasetId: `etf_${result.exchange}`,
        records: result.records,
        metadata: {
          exchange: result.exchange,
          source: result.source,
          summary: result.summary,
        },
      }));
    }

    return Object.freeze({
      ok: true,
      validation,
      writes: Object.freeze(writes),
    });
  }
}

module.exports = {
  SyncEtfSecurityMasterUseCase,
  normalizeSourceResult,
};
