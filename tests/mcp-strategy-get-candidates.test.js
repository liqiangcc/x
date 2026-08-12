"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  TOOL_DEFINITION,
  createStrategyGetCandidatesTool,
} = require("../src/adapters/mcp/tools/strategy_get_candidates");

function resultPayload() {
  return {
    status: "ready",
    strategyId: "alpha",
    date: "2026-02-10",
    build: {
      id: "b1",
      strategyVersion: 2,
      dataVersion: "v2",
      algorithmVersion: 8,
      status: "ready",
      signalCount: 2,
    },
    candidates: [{
      rank: 1,
      securityKey: "1.600001",
      code: "600001",
      market: 1,
      rankingValues: [1],
      qualityIssues: [],
    }],
    page: {
      offset: 0,
      limit: 50,
      returned: 1,
      total: 1,
      hasMore: false,
      nextOffset: null,
    },
    meta: { source: { kind: "fake", readonly: true } },
  };
}

test("strategy_get_candidates MCP definition is bounded, read-only, and evidence is opt-in", () => {
  assert.equal(TOOL_DEFINITION.name, "strategy_get_candidates");
  assert.deepEqual(TOOL_DEFINITION.inputSchema.required, ["strategyId"]);
  assert.equal(TOOL_DEFINITION.inputSchema.additionalProperties, false);
  assert.equal(TOOL_DEFINITION.inputSchema.properties.limit.maximum, 200);
  assert.equal(TOOL_DEFINITION.inputSchema.properties.includeEvidence.default, false);
  assert.equal(TOOL_DEFINITION.annotations.readOnlyHint, true);
  assert.equal(TOOL_DEFINITION.annotations.destructiveHint, false);
  assert.equal(TOOL_DEFINITION.annotations.idempotentHint, true);
  assert.equal(TOOL_DEFINITION.annotations.openWorldHint, false);
});

test("strategy_get_candidates MCP handler delegates unchanged input to application", async () => {
  const calls = [];
  const expected = resultPayload();
  const tool = createStrategyGetCandidatesTool({
    useCase: {
      async execute(input) {
        calls.push(input);
        return expected;
      },
    },
  });
  const input = {
    strategyId: "alpha",
    date: "2026-02-10",
    limit: 25,
    offset: 5,
    includeEvidence: true,
  };
  const result = await tool.handler(input);
  assert.deepEqual(calls, [input]);
  assert.deepEqual(result.structuredContent, expected);
  assert.deepEqual(JSON.parse(result.content[0].text), expected);
  assert.equal(result.isError, undefined);
});

test("strategy_get_candidates MCP handler preserves stable SignalReader errors", async () => {
  const tool = createStrategyGetCandidatesTool({
    useCase: {
      async execute() {
        const error = new Error("Strategy signal store is unavailable.");
        error.code = "signal_store_unavailable";
        throw error;
      },
    },
  });
  const result = await tool.handler({ strategyId: "alpha" });
  assert.equal(result.isError, true);
  assert.deepEqual(result.structuredContent, {
    error: {
      code: "signal_store_unavailable",
      message: "Strategy signal store is unavailable.",
    },
  });
  assert.equal(result.content[0].text.includes("stack"), false);
});

test("strategy_get_candidates MCP tool cannot construct storage dependencies itself", () => {
  assert.throws(() => createStrategyGetCandidatesTool(), /useCase/);
  assert.throws(() => createStrategyGetCandidatesTool({ useCase: {} }), /execute/);
});
