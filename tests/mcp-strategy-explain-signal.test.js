"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  TOOL_DEFINITION,
  createStrategyExplainSignalTool,
} = require("../src/adapters/mcp/tools/strategy_explain_signal");

function resultPayload() {
  return {
    status: "ready",
    strategyId: "alpha",
    date: "2026-02-10",
    securityKey: "1.600002",
    build: {
      id: "b1",
      strategyVersion: 2,
      dataVersion: "v2",
      algorithmVersion: 8,
      status: "ready",
      signalCount: 2,
    },
    candidate: {
      rank: 2,
      securityKey: "1.600002",
      code: "600002",
      market: 1,
      rankingValues: [2],
      qualityIssues: [],
      evidence: {
        rule_summary: "matched",
        rules: [{ key: "r1", type: "value_compare", ok: true }],
      },
    },
    meta: { source: { kind: "fake", readonly: true } },
  };
}

test("strategy_explain_signal MCP definition requires exact identity and is read-only", () => {
  assert.equal(TOOL_DEFINITION.name, "strategy_explain_signal");
  assert.deepEqual(TOOL_DEFINITION.inputSchema.required, ["strategyId", "date", "securityKey"]);
  assert.equal(TOOL_DEFINITION.inputSchema.additionalProperties, false);
  assert.equal(TOOL_DEFINITION.inputSchema.properties.strategyId.maxLength, 128);
  assert.equal(TOOL_DEFINITION.inputSchema.properties.securityKey.maxLength, 160);
  assert.equal(TOOL_DEFINITION.annotations.readOnlyHint, true);
  assert.equal(TOOL_DEFINITION.annotations.destructiveHint, false);
  assert.equal(TOOL_DEFINITION.annotations.idempotentHint, true);
  assert.equal(TOOL_DEFINITION.annotations.openWorldHint, false);
});

test("strategy_explain_signal MCP handler delegates exact input and returns stored evidence", async () => {
  const calls = [];
  const expected = resultPayload();
  const tool = createStrategyExplainSignalTool({
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
    securityKey: "1.600002",
  };
  const result = await tool.handler(input);
  assert.deepEqual(calls, [input]);
  assert.deepEqual(result.structuredContent, expected);
  assert.equal(result.structuredContent.candidate.evidence.rules[0].key, "r1");
  assert.deepEqual(JSON.parse(result.content[0].text), expected);
  assert.equal(result.isError, undefined);
});

test("strategy_explain_signal MCP handler preserves stable SignalReader errors", async () => {
  const tool = createStrategyExplainSignalTool({
    useCase: {
      async execute() {
        const error = new Error("Strategy signal store is unavailable.");
        error.code = "signal_store_unavailable";
        throw error;
      },
    },
  });
  const result = await tool.handler({
    strategyId: "alpha",
    date: "2026-02-10",
    securityKey: "1.600002",
  });
  assert.equal(result.isError, true);
  assert.deepEqual(result.structuredContent, {
    error: {
      code: "signal_store_unavailable",
      message: "Strategy signal store is unavailable.",
    },
  });
  assert.equal(result.content[0].text.includes("stack"), false);
});

test("strategy_explain_signal MCP tool cannot construct storage dependencies itself", () => {
  assert.throws(() => createStrategyExplainSignalTool(), /useCase/);
  assert.throws(() => createStrategyExplainSignalTool({ useCase: {} }), /execute/);
});
