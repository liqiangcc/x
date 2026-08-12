"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  TOOL_DEFINITION,
  createAnalyticsGetBollingerTool,
} = require("../src/adapters/mcp/tools/analytics_get_bollinger");

function useCaseResult() {
  return {
    security: { code: "600001", market: 1 },
    period: "daily",
    startDate: null,
    endDate: "2026-08-12",
    window: 20,
    multiplier: 2,
    stddevMode: "population",
    priceField: "close",
    points: [{
      date: "2026-08-12",
      price: 10,
      lower: 8,
      middle: 9,
      stddev: 0.5,
      upper: 10,
    }],
    latest: {
      date: "2026-08-12",
      price: 10,
      lower: 8,
      middle: 9,
      stddev: 0.5,
      upper: 10,
    },
    coverage: {
      inputBars: 20,
      returnedPoints: 1,
      validPoints: 1,
      warmupComplete: true,
    },
    meta: {
      dataMode: "legacy_approximate",
      priceView: "legacy_forward_adjusted",
      qualityIssues: [],
      source: { kind: "repo_ledger", contentHash: "hash", path: "fixture.json" },
    },
  };
}

test("Bollinger MCP definition is bounded, read-only, and explicit about calculation semantics", () => {
  assert.equal(TOOL_DEFINITION.name, "analytics_get_bollinger");
  assert.equal(TOOL_DEFINITION.inputSchema.type, "object");
  assert.equal(TOOL_DEFINITION.inputSchema.additionalProperties, false);
  assert.deepEqual(TOOL_DEFINITION.inputSchema.required, ["code", "market", "endDate"]);
  assert.equal(TOOL_DEFINITION.inputSchema.properties.window.default, 20);
  assert.equal(TOOL_DEFINITION.inputSchema.properties.window.maximum, 250);
  assert.equal(TOOL_DEFINITION.inputSchema.properties.points.maximum, 200);
  assert.deepEqual(TOOL_DEFINITION.inputSchema.properties.stddevMode.enum, ["population", "sample"]);
  assert.deepEqual(TOOL_DEFINITION.inputSchema.properties.priceField.enum, ["open", "close", "high", "low"]);
  assert.equal(TOOL_DEFINITION.annotations.readOnlyHint, true);
  assert.equal(TOOL_DEFINITION.annotations.destructiveHint, false);
  assert.equal(TOOL_DEFINITION.annotations.idempotentHint, true);
  assert.equal(TOOL_DEFINITION.annotations.openWorldHint, false);
});

test("Bollinger MCP handler delegates unchanged input to the application use case", async () => {
  const calls = [];
  const expected = useCaseResult();
  const tool = createAnalyticsGetBollingerTool({
    useCase: {
      async execute(input) {
        calls.push(input);
        return expected;
      },
    },
  });
  const input = {
    code: "600001",
    market: 1,
    endDate: "2026-08-12",
    period: "daily",
    window: 20,
    multiplier: 2,
    stddevMode: "population",
    priceField: "close",
    points: 5,
  };

  const result = await tool.handler(input);

  assert.deepEqual(calls, [input]);
  assert.deepEqual(result.structuredContent, expected);
  assert.deepEqual(JSON.parse(result.content[0].text), expected);
  assert.equal(result.isError, undefined);
});

test("Bollinger MCP handler uses shared stable error mapping", async () => {
  const tool = createAnalyticsGetBollingerTool({
    useCase: {
      async execute() {
        throw new TypeError("sample stddevMode requires window to be at least 2.");
      },
    },
  });

  const result = await tool.handler({
    code: "600001",
    market: 1,
    endDate: "2026-08-12",
    window: 1,
    stddevMode: "sample",
  });
  assert.equal(result.isError, true);
  assert.deepEqual(result.structuredContent, {
    error: {
      code: "invalid_arguments",
      message: "sample stddevMode requires window to be at least 2.",
    },
  });
  assert.equal(result.content[0].text.includes("stack"), false);
});

test("Bollinger MCP tool requires an application use case instead of reading ledger data itself", () => {
  assert.throws(() => createAnalyticsGetBollingerTool(), /useCase/);
  assert.throws(() => createAnalyticsGetBollingerTool({ useCase: {} }), /execute/);
});
