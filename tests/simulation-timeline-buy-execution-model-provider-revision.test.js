"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  intersectExecutionAssumptionTimelines,
} = require("../src/simulation/execution/execution_assumption_timeline");
const {
  TimelineBuyExecutionModelProvider,
} = require("../src/simulation/execution/timeline_buy_execution_model_provider");

function executionProfile(id, { tickSize = 0.001 } = {}) {
  return {
    id,
    assetClass: id,
    kind: `${id}_next_open`,
    ruleApproximation: "synthetic_phase_c_revision",
    settlement: { sharesAvailable: "next_trading_day" },
    lotRules: { buyLotSize: 100 },
    priceRules: { tickSize },
    feeRules: { stampDutyRate: 0 },
    restrictionRules: { kind: "none" },
    qualityIssues: [],
  };
}

function revision({ revisionId, effectiveFrom, effectiveTo, tickSize } = {}) {
  return {
    revisionId,
    profileId: "domestic_stock_etf",
    effectiveFrom,
    effectiveTo,
    profile: executionProfile("domestic_stock_etf", { tickSize }),
    source: {
      provider: "synthetic_phase_c_provider",
      document: `synthetic://${revisionId}`,
      version: "v1",
      collectedAt: "2026-08-14T00:00:00Z",
    },
    qualityIssues: [],
  };
}

function buildTimeline() {
  return intersectExecutionAssumptionTimelines({
    startDate: "2026-01-01",
    endDate: "2026-01-03",
    profileSegments: [
      {
        startDate: "2026-01-01",
        endDate: "2026-01-03",
        profileId: "domestic_stock_etf",
      },
    ],
    revisionSegments: [
      {
        startDate: "2026-01-01",
        endDate: "2026-01-01",
        revision: revision({
          revisionId: "domestic.r1",
          effectiveFrom: "2026-01-01",
          effectiveTo: "2026-01-01",
          tickSize: 0.001,
        }),
      },
      {
        startDate: "2026-01-02",
        endDate: "2026-01-03",
        revision: revision({
          revisionId: "domestic.r2",
          effectiveFrom: "2026-01-02",
          effectiveTo: null,
          tickSize: 0.002,
        }),
      },
    ],
  });
}

function createRecordingResolver() {
  const calls = [];
  return {
    calls,
    resolve(request) {
      calls.push(request);
      const revisionId = request.assumptionRevisionId ?? "profile-only";
      return {
        executeBuy() {
          return { status: "not_executed" };
        },
        describe() {
          return { revisionId };
        },
      };
    },
  };
}

const bars = [
  { date: "2025-12-31" },
  { date: "2026-01-01" },
  { date: "2026-01-02" },
  { date: "2026-01-03" },
];

test("timeline provider selects the execution-date revision instead of the signal-date revision", () => {
  const timeline = buildTimeline();
  const resolver = createRecordingResolver();
  const provider = new TimelineBuyExecutionModelProvider({
    segments: timeline.segments,
    executionModelResolver: resolver,
  });

  const model = provider.resolveForBuy({
    bars,
    signalDate: "2026-01-01",
  });

  assert.equal(model.describe().revisionId, "domestic.r2");
  assert.equal(resolver.calls.length, 1);
  assert.equal(resolver.calls[0].model, "domestic_stock_etf");
  assert.equal(resolver.calls[0].assumptionRevisionId, "domestic.r2");
  assert.equal(resolver.calls[0].executionProfile.priceRules.tickSize, 0.002);
  assert.equal(
    resolver.calls[0].executionProfile,
    timeline.segments[1].executionProfile
  );
});

test("timeline provider caches the same profile family separately by assumption revision", () => {
  const timeline = buildTimeline();
  const resolver = createRecordingResolver();
  const provider = new TimelineBuyExecutionModelProvider({
    segments: timeline.segments,
    executionModelResolver: resolver,
  });

  const firstRevisionModel = provider.resolveForBuy({
    bars,
    signalDate: "2025-12-31",
  });
  const secondRevisionModel = provider.resolveForBuy({
    bars,
    signalDate: "2026-01-01",
  });
  const secondRevisionModelAgain = provider.resolveForBuy({
    bars,
    signalDate: "2026-01-02",
  });

  assert.equal(resolver.calls.length, 2);
  assert.equal(resolver.calls[0].assumptionRevisionId, "domestic.r1");
  assert.equal(resolver.calls[1].assumptionRevisionId, "domestic.r2");
  assert.notEqual(firstRevisionModel, secondRevisionModel);
  assert.equal(secondRevisionModelAgain, secondRevisionModel);
});

test("timeline provider keeps profile-only segments backward compatible", () => {
  const resolver = createRecordingResolver();
  const provider = new TimelineBuyExecutionModelProvider({
    segments: [
      {
        startDate: "2026-01-01",
        endDate: "2026-01-03",
        profileId: "domestic_stock_etf",
      },
    ],
    executionModelResolver: resolver,
    executionConfig: { slippageBps: 12 },
  });

  const model = provider.resolveForBuy({
    bars,
    signalDate: "2026-01-01",
  });
  const modelAgain = provider.resolveForBuy({
    bars,
    signalDate: "2026-01-02",
  });

  assert.equal(modelAgain, model);
  assert.equal(resolver.calls.length, 1);
  assert.deepEqual(resolver.calls[0], {
    model: "domestic_stock_etf",
    executionConfig: { slippageBps: 12 },
  });
});

test("timeline provider rejects half-specified revision-aware segments", () => {
  const resolver = createRecordingResolver();
  assert.throws(
    () => new TimelineBuyExecutionModelProvider({
      segments: [
        {
          startDate: "2026-01-01",
          endDate: "2026-01-03",
          profileId: "domestic_stock_etf",
          revisionId: "domestic.r1",
        },
      ],
      executionModelResolver: resolver,
    }),
    /revisionId and executionProfile together/
  );
});