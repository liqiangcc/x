"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const {
  LedgerExecutionProfileTimelineReader,
} = require("../src/adapters/ledger/ledger_execution_profile_timeline_reader");
const {
  validateExecutionProfileRepository,
} = require("../scripts/validate_execution_profiles");

const DATA_ROOT = path.join(__dirname, "..", "data");
const REVISION_ID = "legacy_a_share.2008-09-19.2011-02-27";
const QUALITY_ISSUES = Object.freeze([
  "broker_commission_uses_simulation_default",
  "minimum_commission_uses_simulation_default",
  "slippage_uses_simulation_default",
]);

test("committed legacy A-share revision covers canonical 2009 history with audited market facts", () => {
  const validation = validateExecutionProfileRepository({ dataRoot: DATA_ROOT });
  assert.equal(validation.ok, true);
  assert.equal(validation.status, "ok");
  assert.deepEqual(validation.summary, {
    revisionCount: 1,
    profileCount: 1,
  });

  const timeline = new LedgerExecutionProfileTimelineReader({
    dataRoot: DATA_ROOT,
  }).readTimeline({
    profileId: "legacy_a_share",
    startDate: "2009-01-01",
    endDate: "2009-12-15",
  });

  assert.equal(timeline.source.available, true);
  assert.deepEqual(timeline.source.profileIds, ["legacy_a_share"]);
  assert.deepEqual(timeline.gaps, []);
  assert.equal(timeline.segments.length, 1);

  const segment = timeline.segments[0];
  const revision = segment.revision;
  assert.equal(segment.startDate, "2009-01-01");
  assert.equal(segment.endDate, "2009-12-15");
  assert.equal(revision.revisionId, REVISION_ID);
  assert.equal(revision.effectiveFrom, "2008-09-19");
  assert.equal(revision.effectiveTo, "2011-02-27");
  assert.equal(revision.profile.id, "legacy_a_share");
  assert.equal(revision.profile.assetClass, "a_share");
  assert.equal(revision.profile.lotRules.buyLotSize, 100);
  assert.equal(revision.profile.priceRules.tickSize, 0.01);
  assert.equal(revision.profile.settlement.sharesAvailable, "next_trading_day");
  assert.equal(revision.profile.feeRules.stampDutyRate, 0.001);
  assert.equal(revision.profile.restrictionRules.kind, "a_share_market");
  assert.deepEqual(revision.profile.qualityIssues, QUALITY_ISSUES);
  assert.deepEqual(revision.qualityIssues, []);
  assert.deepEqual(revision.source, {
    provider: "repository_evidence_bundle",
    document: "docs/LEGACY_A_SHARE_REVISION_BOUNDARY_AUDIT.md",
    version: "4b5cb376df08c93325f6edec1b199a7ed2f23271",
    collectedAt: "2026-08-14T10:31:55.000Z",
  });
});

test("committed legacy A-share revision stops at the audited 2011 provenance boundary", () => {
  const timeline = new LedgerExecutionProfileTimelineReader({
    dataRoot: DATA_ROOT,
  }).readTimeline({
    profileId: "legacy_a_share",
    startDate: "2011-02-28",
    endDate: "2011-02-28",
  });

  assert.deepEqual(timeline.segments, []);
  assert.deepEqual(timeline.gaps, [
    { startDate: "2011-02-28", endDate: "2011-02-28" },
  ]);
});
