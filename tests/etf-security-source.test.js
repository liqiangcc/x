"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  normalizeEtfSecurityFact,
} = require("../src/market/etf_security_fact_normalizer");
const {
  assertEtfSecuritySource,
} = require("../src/ports/market/etf_security_source");
const {
  OfficialExchangeEtfSource,
} = require("../src/sources/exchange/official_etf_source");
const {
  LedgerSecurityMasterReader,
} = require("../src/adapters/ledger/ledger_security_master_reader");
const {
  LedgerSecurityMasterWriter,
} = require("../src/adapters/ledger/ledger_security_master_writer");
const {
  SyncEtfSecurityMasterUseCase,
} = require("../src/application/market/sync_etf_security_master");
const {
  createSecurityExecutionProfileResolver,
} = require("../src/simulation/execution/security_execution_profile_resolver");

function snapshot(records, name, { complete = true, exchange = "sse" } = {}) {
  const host = exchange === "szse" ? "www.szse.cn" : "www.sse.com.cn";
  return {
    complete,
    records,
    source: {
      document: `https://${host}/${name}`,
      version: `${name}-v1`,
      collectedAt: "2026-08-12T14:30:00.000Z",
    },
  };
}

function sourceFact({ code = "510300", eligible = false, effectiveFrom = "2026-01-01" } = {}) {
  return normalizeEtfSecurityFact({
    exchange: "sse",
    security: { code, market: 1 },
    intradayRoundTripEligible: eligible,
    effectiveFrom,
    provenance: {
      provider: "sse",
      document: "https://www.sse.com.cn/example",
      version: "20260812",
      collectedAt: "2026-08-12T14:30:00.000Z",
    },
    qualityIssues: [],
  });
}

test("ETF security source port stays narrow", () => {
  const source = { async fetchFacts() { return { exchange: "sse", records: [] }; } };
  assert.equal(assertEtfSecuritySource(source), source);
  assert.throws(() => assertEtfSecuritySource(null), /must be an object/);
  assert.throws(() => assertEtfSecuritySource({}), /fetchFacts/);
});

test("official exchange ETF source derives T+0 only from complete membership snapshots", async () => {
  const source = new OfficialExchangeEtfSource({
    exchange: "sse",
    fetchAllEtfs: async () => snapshot([
      { code: "510300", listingDate: "2012-05-28" },
      { code: "511010", listingDate: "2013-03-25" },
    ], "all"),
    fetchT0Etfs: async () => snapshot([
      { code: "511010" },
    ], "t0"),
  });

  const result = await source.fetchFacts();
  assert.equal(result.exchange, "sse");
  assert.deepEqual(result.summary, { etfCount: 2, t0Count: 1, t1Count: 1 });
  assert.equal(result.records[0].security.code, "510300");
  assert.equal(result.records[0].intradayRoundTripEligible, false);
  assert.equal(result.records[1].security.code, "511010");
  assert.equal(result.records[1].intradayRoundTripEligible, true);
  assert.equal(result.records[1].source.provider, "sse");
  assert.match(result.records[1].source.document, /all=.*;t0=.*/);
});

test("official ETF source fails closed on incomplete, inconsistent, or third-party snapshots", async () => {
  const incomplete = new OfficialExchangeEtfSource({
    exchange: "szse",
    fetchAllEtfs: async () => snapshot(
      [{ code: "159001", listingDate: "2026-01-01" }],
      "all",
      { complete: false, exchange: "szse" }
    ),
    fetchT0Etfs: async () => snapshot([], "t0", { exchange: "szse" }),
  });
  await assert.rejects(() => incomplete.fetchFacts(), /complete must be true/);

  const inconsistent = new OfficialExchangeEtfSource({
    exchange: "szse",
    fetchAllEtfs: async () => snapshot(
      [{ code: "159001", listingDate: "2026-01-01" }],
      "all",
      { exchange: "szse" }
    ),
    fetchT0Etfs: async () => snapshot([{ code: "159999" }], "t0", { exchange: "szse" }),
  });
  await assert.rejects(() => inconsistent.fetchFacts(), /absent from the complete ETF snapshot/);

  const thirdParty = new OfficialExchangeEtfSource({
    exchange: "sse",
    fetchAllEtfs: async () => ({
      ...snapshot([{ code: "510300", listingDate: "2026-01-01" }], "all"),
      source: {
        document: "https://example.test/all",
        version: "all-v1",
        collectedAt: "2026-08-12T14:30:00.000Z",
      },
    }),
    fetchT0Etfs: async () => snapshot([], "t0"),
  });
  await assert.rejects(() => thirdParty.fetchFacts(), /must belong to sse\.com\.cn/);
});

test("ETF fact normalizer requires explicit eligibility and matching provenance", () => {
  assert.throws(() => normalizeEtfSecurityFact({
    exchange: "sse",
    security: { code: "510300", market: 1 },
    effectiveFrom: "2026-01-01",
    provenance: {
      provider: "sse",
      document: "x",
      version: "v1",
      collectedAt: "2026-08-12T00:00:00Z",
    },
  }), /explicit boolean/);

  assert.throws(() => normalizeEtfSecurityFact({
    exchange: "sse",
    security: { code: "510300", market: 1 },
    intradayRoundTripEligible: false,
    effectiveFrom: "2026-01-01",
    provenance: {
      provider: "szse",
      document: "x",
      version: "v1",
      collectedAt: "2026-08-12T00:00:00Z",
    },
  }), /must match exchange/);
});

test("ETF sync validates before writing and registers generic record_file datasets", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "x-etf-security-sync-"));
  try {
    fs.mkdirSync(path.join(root, "security_master"), { recursive: true });
    fs.writeFileSync(path.join(root, "security_master", "manifest.json"), JSON.stringify({
      schemaVersion: 1,
      recordSets: [],
      records: [],
    }, null, 2));

    const useCase = new SyncEtfSecurityMasterUseCase({
      sources: [{
        async fetchFacts() {
          return {
            exchange: "sse",
            records: [
              sourceFact({ code: "510300", eligible: false }),
              sourceFact({ code: "511010", eligible: true }),
            ],
            source: { provider: "sse" },
            summary: { etfCount: 2 },
          };
        },
      }],
      securityMasterWriter: new LedgerSecurityMasterWriter({ dataRoot: root }),
      securityExecutionProfileResolver: createSecurityExecutionProfileResolver(),
    });

    const result = await useCase.execute();
    assert.equal(result.ok, true);
    assert.equal(result.writes.length, 1);
    assert.equal(result.writes[0].datasetId, "etf_sse");
    assert.equal(result.writes[0].recordCount, 2);

    const manifest = JSON.parse(fs.readFileSync(path.join(root, "security_master", "manifest.json"), "utf8"));
    assert.deepEqual(manifest.recordSets, [{
      kind: "record_file",
      path: "security_master/records/etf_sse.json",
    }]);

    const reader = new LedgerSecurityMasterReader({ dataRoot: root });
    assert.equal(reader.readRecord({ code: "510300", market: 1 }).instrumentType, "etf");
    assert.equal(reader.readRecord({ code: "511010", market: 1 }).intradayRoundTripEligible, true);
    const snapshotResult = reader.readSnapshot();
    assert.equal(snapshotResult.entries.length, 2);
    assert.equal(snapshotResult.entries[0].origin.recordSetKind, "record_file");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("ETF sync never writes records when the existing quality gate rejects the snapshot", async () => {
  let writes = 0;
  const useCase = new SyncEtfSecurityMasterUseCase({
    sources: [{
      async fetchFacts() {
        return {
          exchange: "sse",
          records: [
            sourceFact({ code: "510300", eligible: false, effectiveFrom: "2026-01-01" }),
            sourceFact({ code: "510300", eligible: true, effectiveFrom: "2026-06-01" }),
          ],
        };
      },
    }],
    securityMasterWriter: {
      writeRecords() {
        writes += 1;
      },
    },
    securityExecutionProfileResolver: createSecurityExecutionProfileResolver(),
  });

  const result = await useCase.execute();
  assert.equal(result.ok, false);
  assert.equal(writes, 0);
  assert.equal(result.writes.length, 0);
  assert.equal(
    result.validation.issues.some((issue) => issue.code === "conflicting_security_fact_overlap"),
    true
  );
});
