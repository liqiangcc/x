"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  assertExecutionProfileTimelineReader,
} = require("../src/ports/simulation/execution_profile_timeline_reader");
const {
  LedgerExecutionProfileTimelineReader,
  normalizeExecutionProfileManifest,
} = require("../src/adapters/ledger/ledger_execution_profile_timeline_reader");
const {
  validateExecutionProfileRepository,
} = require("../scripts/validate_execution_profiles");

function executionProfile(id, tickSize = 0.001) {
  return {
    id,
    assetClass: "fixture_asset",
    kind: "fixture_next_open",
    ruleApproximation: "fixture_only",
    settlement: { sharesAvailable: "next_trading_day" },
    lotRules: { buyLotSize: 100 },
    priceRules: { tickSize },
    feeRules: { commissionRate: 0.0001 },
    restrictionRules: { kind: "none" },
    qualityIssues: [],
  };
}

function revision({
  revisionId,
  profileId = "domestic_stock_etf",
  effectiveFrom,
  effectiveTo = null,
  tickSize = 0.001,
} = {}) {
  return {
    revisionId,
    profileId,
    effectiveFrom,
    effectiveTo,
    profile: executionProfile(profileId, tickSize),
    source: {
      provider: "test_provider",
      document: "tests/execution-profile-revisions.json",
      version: revisionId,
      collectedAt: "2026-08-14T00:00:00.000Z",
    },
    qualityIssues: [],
  };
}

function createFixture(revisions) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "x-execution-profile-ledger-"));
  fs.mkdirSync(path.join(root, "execution_profiles"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "execution_profiles", "manifest.json"),
    JSON.stringify({ schemaVersion: 1, revisions }, null, 2)
  );
  return root;
}

test("ExecutionProfileTimelineReader port stays narrow", () => {
  const reader = { readTimeline() { return null; } };
  assert.equal(assertExecutionProfileTimelineReader(reader), reader);
  assert.throws(() => assertExecutionProfileTimelineReader(null), /must be an object/);
  assert.throws(() => assertExecutionProfileTimelineReader({}), /readTimeline/);
});

test("ledger execution profile reader clips revisions and preserves change boundaries", () => {
  const dataRoot = createFixture([
    revision({
      revisionId: "etf-r1",
      effectiveFrom: "2026-01-01",
      effectiveTo: "2026-06-30",
      tickSize: 0.001,
    }),
    revision({
      revisionId: "etf-r2",
      effectiveFrom: "2026-07-01",
      effectiveTo: null,
      tickSize: 0.002,
    }),
  ]);
  try {
    const reader = new LedgerExecutionProfileTimelineReader({ dataRoot });
    const timeline = reader.readTimeline({
      profileId: "domestic_stock_etf",
      startDate: "2026-06-15",
      endDate: "2026-07-15",
    });

    assert.deepEqual(timeline.gaps, []);
    assert.deepEqual(timeline.segments.map((segment) => ({
      startDate: segment.startDate,
      endDate: segment.endDate,
      revisionId: segment.revision.revisionId,
      tickSize: segment.revision.profile.priceRules.tickSize,
    })), [
      {
        startDate: "2026-06-15",
        endDate: "2026-06-30",
        revisionId: "etf-r1",
        tickSize: 0.001,
      },
      {
        startDate: "2026-07-01",
        endDate: "2026-07-15",
        revisionId: "etf-r2",
        tickSize: 0.002,
      },
    ]);
    assert.equal(timeline.source.kind, "repo_execution_profile_revisions");
    assert.equal(timeline.source.revisionCount, 2);
    assert.deepEqual(timeline.source.profileIds, ["domestic_stock_etf"]);
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("ledger execution profile reader reports historical gaps instead of backfilling with a newer revision", () => {
  const dataRoot = createFixture([
    revision({
      revisionId: "etf-current",
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
    }),
  ]);
  try {
    const timeline = new LedgerExecutionProfileTimelineReader({ dataRoot }).readTimeline({
      profileId: "domestic_stock_etf",
      startDate: "2025-12-15",
      endDate: "2026-01-15",
    });
    assert.deepEqual(timeline.gaps, [
      { startDate: "2025-12-15", endDate: "2025-12-31" },
    ]);
    assert.deepEqual(timeline.segments.map((segment) => ({
      startDate: segment.startDate,
      endDate: segment.endDate,
      revisionId: segment.revision.revisionId,
    })), [
      {
        startDate: "2026-01-01",
        endDate: "2026-01-15",
        revisionId: "etf-current",
      },
    ]);
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("missing execution profile manifest is an explicit unconfigured state with full coverage gap", () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "x-execution-profile-missing-"));
  try {
    const timeline = new LedgerExecutionProfileTimelineReader({ dataRoot }).readTimeline({
      profileId: "legacy_a_share",
      startDate: "2020-01-01",
      endDate: "2020-01-31",
    });
    assert.equal(timeline.source.available, false);
    assert.deepEqual(timeline.segments, []);
    assert.deepEqual(timeline.gaps, [
      { startDate: "2020-01-01", endDate: "2020-01-31" },
    ]);

    const quality = validateExecutionProfileRepository({ dataRoot });
    assert.equal(quality.ok, true);
    assert.equal(quality.status, "unconfigured");
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("manifest quality validation reuses authoritative revision normalization", () => {
  const overlapping = [
    revision({
      revisionId: "r1",
      effectiveFrom: "2026-01-01",
      effectiveTo: "2026-06-30",
    }),
    revision({
      revisionId: "r2",
      effectiveFrom: "2026-06-01",
      effectiveTo: null,
    }),
  ];
  assert.throws(
    () => normalizeExecutionProfileManifest({ schemaVersion: 1, revisions: overlapping }),
    /must not overlap/
  );
  assert.throws(
    () => normalizeExecutionProfileManifest({ schemaVersion: 2, revisions: [] }),
    /schemaVersion must be 1/
  );
});

test("CI quality validator rejects an empty committed manifest", () => {
  const dataRoot = createFixture([]);
  try {
    const result = validateExecutionProfileRepository({ dataRoot });
    assert.equal(result.ok, false);
    assert.equal(result.status, "empty");
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("ledger execution profile reader blocks manifest paths outside dataRoot", () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "x-execution-profile-path-"));
  try {
    const reader = new LedgerExecutionProfileTimelineReader({
      dataRoot,
      manifestPath: "../outside.json",
    });
    assert.throws(() => reader.readTimeline({
      profileId: "legacy_a_share",
      startDate: "2020-01-01",
      endDate: "2020-01-31",
    }), /stay within dataRoot/);
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("execution profile repository boundaries keep storage, classification, and model construction separated", () => {
  const adapterSource = fs.readFileSync(
    require.resolve("../src/adapters/ledger/ledger_execution_profile_timeline_reader"),
    "utf8"
  );
  const portSource = fs.readFileSync(
    require.resolve("../src/ports/simulation/execution_profile_timeline_reader"),
    "utf8"
  );

  assert.doesNotMatch(
    adapterSource,
    /security_master|SecurityMaster|securityExecutionProfileResolver|BuyExecutionModel|frictionless|mcp/i
  );
  assert.doesNotMatch(portSource, /node:fs|adapters\/ledger|SecurityMaster|BuyExecutionModel/);
});
