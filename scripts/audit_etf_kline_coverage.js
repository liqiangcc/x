"use strict";

const { LedgerSecurityMasterReader } = require("../src/adapters/ledger/ledger_security_master_reader");
const { LedgerSecurityMetadataReader } = require("../src/adapters/ledger/ledger_security_metadata_reader");
const { LedgerKlineReader } = require("../src/adapters/ledger/ledger_kline_reader");
const {
  createSecurityExecutionProfileResolver,
} = require("../src/simulation/execution/security_execution_profile_resolver");

const DEFAULT_RECORD_PATH = "security_master/records/etf_sse.json";
const DEFAULT_PERIOD = "daily";
const DEFAULT_END_DATE = "9999-12-31";
const DEFAULT_SAMPLE_LIMIT = 20;

function securityKey(security) {
  return `${security.market}:${security.code}`;
}

function nonNegativeInteger(value, field) {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${field} must be a non-negative integer.`);
  }
  return value;
}

function collectDatasetSecurities(snapshot, recordPath) {
  const unique = new Map();
  for (const entry of snapshot.entries ?? []) {
    if (entry.origin?.path !== recordPath) continue;
    const security = entry.record?.security;
    if (!security) continue;
    unique.set(securityKey(security), security);
  }
  return [...unique.values()].sort((left, right) => securityKey(left).localeCompare(securityKey(right)));
}

async function inspectSecurity({ security, securityMetadataReader, profileResolver, klineReader, period, endDate }) {
  const metadata = await securityMetadataReader.readMetadata(security);
  if (!metadata) {
    throw new Error(`missing Security Master metadata for ${securityKey(security)}`);
  }
  const profileId = profileResolver.resolve({ security, metadata });
  const history = await klineReader.readRange({
    ...security,
    endDate,
    period,
    limit: null,
  });
  const bars = Array.isArray(history.bars) ? history.bars : [];
  return Object.freeze({
    security,
    profileId,
    metadataEffectiveFrom: metadata.effectiveFrom ?? null,
    metadataEffectiveTo: metadata.effectiveTo ?? null,
    barCount: bars.length,
    firstDate: bars[0]?.date ?? null,
    lastDate: bars.at(-1)?.date ?? null,
    klinePath: history.source?.path ?? null,
    qualityIssues: Object.freeze([...(history.qualityIssues ?? [])]),
  });
}

function summarizeProfiles(rows, sampleLimit) {
  const grouped = new Map();
  for (const row of rows) {
    const group = grouped.get(row.profileId) ?? [];
    group.push(row);
    grouped.set(row.profileId, group);
  }

  return Object.fromEntries([...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([profileId, items]) => {
      const withKline = items.filter((item) => item.barCount > 0);
      const runnable = items.filter((item) => item.barCount >= 2);
      return [profileId, Object.freeze({
        securityCount: items.length,
        withKlineCount: withKline.length,
        runnableCount: runnable.length,
        samples: Object.freeze(runnable.slice(0, sampleLimit)),
      })];
    }));
}

async function auditEtfKlineCoverage({
  recordPath = DEFAULT_RECORD_PATH,
  period = DEFAULT_PERIOD,
  endDate = DEFAULT_END_DATE,
  sampleLimit = DEFAULT_SAMPLE_LIMIT,
  securityMasterReader = new LedgerSecurityMasterReader(),
  securityMetadataReader = null,
  profileResolver = createSecurityExecutionProfileResolver(),
  klineReader = new LedgerKlineReader(),
} = {}) {
  nonNegativeInteger(sampleLimit, "sampleLimit");
  const metadataReader = securityMetadataReader
    ?? new LedgerSecurityMetadataReader({ securityMasterReader });
  const snapshot = await securityMasterReader.readSnapshot();
  const securities = collectDatasetSecurities(snapshot, recordPath);
  const rows = await Promise.all(securities.map((security) => inspectSecurity({
    security,
    securityMetadataReader: metadataReader,
    profileResolver,
    klineReader,
    period,
    endDate,
  })));
  const withKline = rows.filter((row) => row.barCount > 0);
  const runnable = rows.filter((row) => row.barCount >= 2);

  return Object.freeze({
    dataset: Object.freeze({
      recordPath,
      securityCount: rows.length,
    }),
    kline: Object.freeze({
      period,
      withKlineCount: withKline.length,
      runnableCount: runnable.length,
    }),
    profiles: Object.freeze(summarizeProfiles(rows, sampleLimit)),
  });
}

async function main() {
  const result = await auditEtfKlineCoverage();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_END_DATE,
  DEFAULT_PERIOD,
  DEFAULT_RECORD_PATH,
  DEFAULT_SAMPLE_LIMIT,
  auditEtfKlineCoverage,
  collectDatasetSecurities,
  inspectSecurity,
  securityKey,
  summarizeProfiles,
};
