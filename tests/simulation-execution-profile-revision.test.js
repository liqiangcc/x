"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  EXECUTION_PROFILE_TIMELINE_READER_METHODS,
  assertExecutionProfileTimelineReader,
} = require("../src/ports/simulation/execution_profile_timeline_reader");
const {
  intersectExecutionAssumptionTimelines,
} = require("../src/simulation/execution/execution_assumption_timeline");
const {
  isExecutionProfileRevisionEffective,
  normalizeExecutionProfileRevision,
  normalizeExecutionProfileRevisions,
} = require("../src/simulation/execution/execution_profile_revision");

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

function executionProfile(id, { tickSize = 0.001, stampDutyRate = 0 } = {}) {
  return {
    id,
    assetClass: id,
    kind: `${id}_next_open`,
    ruleApproximation: "synthetic_test_revision",
    settlement: { sharesAvailable: "next_trading_day" },
    lotRules: { buyLotSize: 100 },
    priceRules: { tickSize },
    feeRules: { stampDutyRate },
    restrictionRules: { kind: "none" },
    qualityIssues: [],
  };
}

function revision({
  revisionId,
  profileId = "domestic_stock_etf",
  effectiveFrom,
  effectiveTo,
  tickSize,
  stampDutyRate,
  qualityIssues = [],
} = {}) {
  return {
    revisionId,
    profileId,
    effectiveFrom,
    effectiveTo,
    profile: executionProfile(profileId, { tickSize, stampDutyRate }),
    source: {
      provider: "synthetic_test_provider",
      document: `synthetic://${revisionId}`,
      version: "v1",
      collectedAt: "2026-08-14T00:00:00Z",
    },
    qualityIssues,
  };
}

test("ExecutionProfileRevision normalizes immutable auditable profile snapshots", () => {
  const normalized = normalizeExecutionProfileRevision(revision({
    revisionId: "domestic.r1",
    effectiveFrom: "20260101",
    effectiveTo: "2026-01-03",
    tickSize: 0.001,
    qualityIssues: ["synthetic_only", "synthetic_only"],
  }));

  assert.deepEqual(normalized, {
    revisionId: "domestic.r1",
    profileId: "domestic_stock_etf",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-01-03",
    profile: executionProfile("domestic_stock_etf", { tickSize: 0.001 }),
    source: {
      provider: "synthetic_test_provider",
      document: "synthetic://domestic.r1",
      version: "v1",
      collectedAt: "2026-08-14T00:00:00.000Z",
    },
    qualityIssues: ["synthetic_only"],
  });
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(Object.isFrozen(normalized.profile), true);
  assert.equal(Object.isFrozen(normalized.source), true);
  assert.equal(isExecutionProfileRevisionEffective(normalized, "2026-01-02"), true);
  assert.equal(isExecutionProfileRevisionEffective(normalized, "2026-01-04"), false);
});

test("ExecutionProfileRevision rejects invalid ranges, profile mismatches, duplicate ids, and overlaps", () => {
  assert.throws(
    () => normalizeExecutionProfileRevision(revision({
      revisionId: "bad-date",
      effectiveFrom: "2026-02-30",
      effectiveTo: null,
    })),
    /valid YYYY-MM-DD/
  );
  assert.throws(
    () => normalizeExecutionProfileRevision(revision({
      revisionId: "backward",
      effectiveFrom: "2026-02-02",
      effectiveTo: "2026-02-01",
    })),
    /must not be earlier/
  );

  const mismatched = revision({
    revisionId: "mismatch",
    profileId: "t0_etf",
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
  });
  mismatched.profile = executionProfile("domestic_stock_etf");
  assert.throws(
    () => normalizeExecutionProfileRevision(mismatched),
    /profile.id must match/
  );

  const first = revision({
    revisionId: "r1",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-01-03",
  });
  const overlapping = revision({
    revisionId: "r2",
    effectiveFrom: "2026-01-03",
    effectiveTo: "2026-01-05",
  });
  assert.throws(
    () => normalizeExecutionProfileRevisions([first, overlapping]),
    /must not overlap/
  );
  assert.throws(
    () => normalizeExecutionProfileRevisions([first, { ...first }]),
    /duplicate execution profile revisionId/
  );

  const adjacent = revision({
    revisionId: "r3",
    effectiveFrom: "2026-01-04",
    effectiveTo: "2026-01-05",
  });
  assert.equal(normalizeExecutionProfileRevisions([first, adjacent]).length, 2);
});

test("ExecutionProfileTimelineReader port stays narrow", () => {
  assert.deepEqual(EXECUTION_PROFILE_TIMELINE_READER_METHODS, ["readTimeline"]);
  const reader = { readTimeline() { return { segments: [], gaps: [] }; } };
  assert.equal(assertExecutionProfileTimelineReader(reader), reader);
  assert.throws(
    () => assertExecutionProfileTimelineReader(null),
    /implementation must be an object/
  );
  assert.throws(
    () => assertExecutionProfileTimelineReader({}),
    /readTimeline/
  );
});

test("pure timeline intersection combines security profile families with rule revisions deterministically", () => {
  const domesticR1 = revision({
    revisionId: "domestic.r1",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-01-02",
    tickSize: 0.001,
  });
  const domesticR2 = revision({
    revisionId: "domestic.r2",
    effectiveFrom: "2026-01-03",
    effectiveTo: null,
    tickSize: 0.002,
    qualityIssues: ["synthetic_rule_change"],
  });
  const t0R1 = revision({
    revisionId: "t0.r1",
    profileId: "t0_etf",
    effectiveFrom: "2026-01-04",
    effectiveTo: "2026-01-05",
    tickSize: 0.001,
  });
  const t0R2 = revision({
    revisionId: "t0.r2",
    profileId: "t0_etf",
    effectiveFrom: "2026-01-06",
    effectiveTo: null,
    tickSize: 0.003,
  });

  const result = intersectExecutionAssumptionTimelines({
    startDate: "2026-01-01",
    endDate: "2026-01-06",
    profileSegments: [
      { startDate: "2026-01-01", endDate: "2026-01-03", profileId: "domestic_stock_etf" },
      { startDate: "2026-01-04", endDate: "2026-01-06", profileId: "t0_etf" },
    ],
    revisionSegments: [
      { startDate: "2026-01-01", endDate: "2026-01-02", revision: domesticR1 },
      { startDate: "2026-01-03", endDate: "2026-01-03", revision: domesticR2 },
      { startDate: "2026-01-04", endDate: "2026-01-05", revision: t0R1 },
      { startDate: "2026-01-06", endDate: "2026-01-06", revision: t0R2 },
    ],
  });

  assert.deepEqual(result.gaps, []);
  assert.deepEqual(
    result.segments.map((segment) => ({
      startDate: segment.startDate,
      endDate: segment.endDate,
      profileId: segment.profileId,
      revisionId: segment.revisionId,
      tickSize: segment.executionProfile.priceRules.tickSize,
      qualityIssues: segment.qualityIssues,
    })),
    [
      {
        startDate: "2026-01-01",
        endDate: "2026-01-02",
        profileId: "domestic_stock_etf",
        revisionId: "domestic.r1",
        tickSize: 0.001,
        qualityIssues: [],
      },
      {
        startDate: "2026-01-03",
        endDate: "2026-01-03",
        profileId: "domestic_stock_etf",
        revisionId: "domestic.r2",
        tickSize: 0.002,
        qualityIssues: ["synthetic_rule_change"],
      },
      {
        startDate: "2026-01-04",
        endDate: "2026-01-05",
        profileId: "t0_etf",
        revisionId: "t0.r1",
        tickSize: 0.001,
        qualityIssues: [],
      },
      {
        startDate: "2026-01-06",
        endDate: "2026-01-06",
        profileId: "t0_etf",
        revisionId: "t0.r2",
        tickSize: 0.003,
        qualityIssues: [],
      },
    ]
  );
});

test("timeline intersection reports uncovered execution-assumption dates instead of filling them", () => {
  const t0Revision = revision({
    revisionId: "t0.gapped",
    profileId: "t0_etf",
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
  });
  const result = intersectExecutionAssumptionTimelines({
    startDate: "2026-01-01",
    endDate: "2026-01-03",
    profileSegments: [
      { startDate: "2026-01-01", endDate: "2026-01-03", profileId: "t0_etf" },
    ],
    revisionSegments: [
      { startDate: "2026-01-01", endDate: "2026-01-01", revision: t0Revision },
      { startDate: "2026-01-03", endDate: "2026-01-03", revision: t0Revision },
    ],
  });

  assert.deepEqual(result.gaps, [
    { startDate: "2026-01-02", endDate: "2026-01-02" },
  ]);
});

test("Phase A execution-assumption Logic remains free of storage, security classification, business, and protocol dependencies", () => {
  const revisionSource = source("src/simulation/execution/execution_profile_revision.js");
  const timelineSource = source("src/simulation/execution/execution_assumption_timeline.js");
  const readerPortSource = source("src/ports/simulation/execution_profile_timeline_reader.js");

  for (const moduleSource of [revisionSource, timelineSource, readerPortSource]) {
    assert.doesNotMatch(moduleSource, /node:fs|adapters\/|ledger_|security_master|SecurityMaster/);
    assert.doesNotMatch(moduleSource, /business\/|DrawdownBuyingPolicy|adapters\/mcp|McpTool/);
    assert.doesNotMatch(moduleSource, /SecurityExecutionProfileResolver|security_execution_profile_resolver/);
  }
  assert.match(revisionSource, /ports\/simulation\/execution_profile/);
  assert.doesNotMatch(timelineSource, /buy_execution_model|profiled_buy_execution_model/);
  assert.doesNotMatch(readerPortSource, /simulation\/execution|market\/|application\//);
});
