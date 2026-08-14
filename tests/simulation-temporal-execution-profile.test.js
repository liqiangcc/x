"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  assertSecurityMasterTimelineReader,
} = require("../src/ports/market/security_master_timeline_reader");
const {
  LedgerSecurityMasterReader,
} = require("../src/adapters/ledger/ledger_security_master_reader");
const {
  LedgerSecurityMasterTimelineReader,
} = require("../src/adapters/ledger/ledger_security_master_timeline_reader");
const {
  ResolveExecutionProfileTimelineUseCase,
} = require("../src/application/simulation/resolve_execution_profile_timeline");
const {
  createSecurityExecutionProfileResolver,
} = require("../src/simulation/execution/security_execution_profile_resolver");

function auditSource(version) {
  return {
    provider: "test_provider",
    document: "test/temporal-security-master.json",
    version,
    collectedAt: "2026-08-13T00:00:00.000Z",
  };
}

function createTemporalFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "x-temporal-profile-"));
  fs.mkdirSync(path.join(root, "security_master"), { recursive: true });
  fs.mkdirSync(path.join(root, "universe", "20260101"), { recursive: true });
  fs.writeFileSync(path.join(root, "universe", "20260101", "stocks.json"), JSON.stringify({
    stocks: [{ code: "510300", market_id: 1, name: "Example ETF" }],
  }));
  fs.writeFileSync(path.join(root, "security_master", "manifest.json"), JSON.stringify({
    schemaVersion: 1,
    recordSets: [{
      kind: "universe_snapshot",
      path: "universe/20260101/stocks.json",
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      classification: {
        instrumentType: "etf",
        intradayRoundTripEligible: false,
      },
      source: auditSource("universe-default-t1"),
      qualityIssues: ["set_level_classification"],
    }],
    records: [
      {
        security: { code: "510300", market: 1 },
        instrumentType: "etf",
        intradayRoundTripEligible: true,
        effectiveFrom: "2026-06-01",
        effectiveTo: "2026-06-30",
        source: auditSource("explicit-t0-window"),
        qualityIssues: [],
      },
      {
        security: { code: "510300", market: 1 },
        instrumentType: "etf",
        intradayRoundTripEligible: false,
        effectiveFrom: "2026-07-01",
        effectiveTo: null,
        source: auditSource("explicit-t1-after"),
        qualityIssues: [],
      },
    ],
  }, null, 2));
  return root;
}

test("SecurityMasterTimelineReader port stays narrow", () => {
  const reader = { readTimeline() { return null; } };
  assert.equal(assertSecurityMasterTimelineReader(reader), reader);
  assert.throws(() => assertSecurityMasterTimelineReader(null), /must be an object/);
  assert.throws(() => assertSecurityMasterTimelineReader({}), /readTimeline/);
});

test("ledger temporal reader preserves Security Master precedence and change boundaries", () => {
  const dataRoot = createTemporalFixture();
  try {
    const masterReader = new LedgerSecurityMasterReader({ dataRoot });
    const reader = new LedgerSecurityMasterTimelineReader({
      securityMasterSnapshotReader: masterReader,
    });
    const timeline = reader.readTimeline(
      { code: "510300", market: 1 },
      { startDate: "2026-05-15", endDate: "2026-07-15" }
    );

    assert.deepEqual(timeline.gaps, []);
    assert.deepEqual(timeline.segments.map((segment) => ({
      startDate: segment.startDate,
      endDate: segment.endDate,
      eligible: segment.record.intradayRoundTripEligible,
      version: segment.record.source.version,
    })), [
      {
        startDate: "2026-05-15",
        endDate: "2026-05-31",
        eligible: false,
        version: "universe-default-t1",
      },
      {
        startDate: "2026-06-01",
        endDate: "2026-06-30",
        eligible: true,
        version: "explicit-t0-window",
      },
      {
        startDate: "2026-07-01",
        endDate: "2026-07-15",
        eligible: false,
        version: "explicit-t1-after",
      },
    ]);

    assert.equal(
      masterReader.readRecord(
        { code: "510300", market: 1 },
        { asOf: "2026-06-15" }
      ).source.version,
      timeline.segments[1].record.source.version
    );
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("temporal execution profile use case maps facts without constructing execution models", async () => {
  const dataRoot = createTemporalFixture();
  try {
    const masterReader = new LedgerSecurityMasterReader({ dataRoot });
    const timelineReader = new LedgerSecurityMasterTimelineReader({
      securityMasterSnapshotReader: masterReader,
    });
    const useCase = new ResolveExecutionProfileTimelineUseCase({
      securityMasterTimelineReader: timelineReader,
      securityExecutionProfileResolver: createSecurityExecutionProfileResolver(),
    });

    const result = await useCase.execute({
      security: { code: "510300", market: 1 },
      startDate: "2026-05-15",
      endDate: "2026-07-15",
    });

    assert.deepEqual(result.segments.map((segment) => ({
      startDate: segment.startDate,
      endDate: segment.endDate,
      profileId: segment.profileId,
      sourceVersion: segment.metadata.source.version,
    })), [
      {
        startDate: "2026-05-15",
        endDate: "2026-05-31",
        profileId: "domestic_stock_etf",
        sourceVersion: "universe-default-t1",
      },
      {
        startDate: "2026-06-01",
        endDate: "2026-06-30",
        profileId: "t0_etf",
        sourceVersion: "explicit-t0-window",
      },
      {
        startDate: "2026-07-01",
        endDate: "2026-07-15",
        profileId: "domestic_stock_etf",
        sourceVersion: "explicit-t1-after",
      },
    ]);
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("temporal execution profile use case fails closed on uncovered dates", async () => {
  const useCase = new ResolveExecutionProfileTimelineUseCase({
    securityMasterTimelineReader: {
      readTimeline() {
        return {
          segments: [],
          gaps: [{ startDate: "2026-01-01", endDate: "2026-01-31" }],
          source: null,
        };
      },
    },
    securityExecutionProfileResolver: createSecurityExecutionProfileResolver(),
  });

  await assert.rejects(
    useCase.execute({
      security: { code: "510300", market: 1 },
      startDate: "2026-01-01",
      endDate: "2026-01-31",
    }),
    /does not fully cover.*2026-01-01\.\.2026-01-31/
  );
});

test("temporal execution profile boundaries keep infrastructure and execution mechanics separated", () => {
  const applicationSource = fs.readFileSync(
    require.resolve("../src/application/simulation/resolve_execution_profile_timeline"),
    "utf8"
  );
  const ledgerSource = fs.readFileSync(
    require.resolve("../src/adapters/ledger/ledger_security_master_timeline_reader"),
    "utf8"
  );

  assert.doesNotMatch(applicationSource, /adapters\/ledger|node:fs|LedgerSecurityMaster/);
  assert.doesNotMatch(
    ledgerSource,
    /legacy_a_share|domestic_stock_etf|t0_etf|frictionless|BuyExecutionModel/
  );
});
