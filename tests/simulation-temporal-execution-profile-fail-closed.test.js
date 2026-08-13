"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ResolveExecutionProfileTimelineUseCase,
} = require("../src/application/simulation/resolve_execution_profile_timeline");
const {
  createSecurityExecutionProfileResolver,
} = require("../src/simulation/execution/security_execution_profile_resolver");

function record() {
  return {
    security: { code: "510300", market: 1 },
    instrumentType: "etf",
    intradayRoundTripEligible: false,
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    source: {
      provider: "test_provider",
      document: "test/partial-timeline.json",
      version: "v1",
      collectedAt: "2026-08-13T00:00:00.000Z",
    },
    qualityIssues: [],
  };
}

test("temporal Application rejects silent coverage holes even when Reader reports no gaps", async () => {
  const useCase = new ResolveExecutionProfileTimelineUseCase({
    securityMasterTimelineReader: {
      readTimeline() {
        return {
          segments: [{
            startDate: "2026-01-10",
            endDate: "2026-01-31",
            record: record(),
          }],
          gaps: [],
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
    /not continuous at 2026-01-01/
  );
});
