"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  TOOL_DEFINITION,
  createAnalyticsGetDrawdownsTool,
} = require("../src/adapters/mcp/tools/analytics_get_drawdowns");

function useCaseResult() {
  return {
    security: { code: "600001", market: 1 },
    period: "daily",
    startDate: "2026-01-01",
    endDate: "2026-08-12",
    minDrawdown: 0.2,
    priceField: "close",
    events: [{
      peakDate: "2026-01-05",
      peakPrice: 10,
      troughDate: "2026-02-02",
      troughPrice: 8,
      drawdown: -0.2,
      peakToTroughTradingDays: 20,
      recoveryDate: null,
      recoveryTradingDays: null,
      status: "ongoing",
    }],
    summary: {
      eventCount: 1,
      maxDrawdown: -0.2,
      ongoingCount: 1,
      recoveredCount: 0,
    },
    meta: {
      dataMode: "legacy_approximate",
      priceView: "legacy_forward_adjusted",
      qualityIssues: [],
      source: { kind: "repo_ledger", contentHash: "hash", path: "data/kline/daily/600/600001.json" },
    },
  };
}

test("drawdowns MCP definition is narrow, read-only, and closed to extra input", () => {
  assert.equal(TOOL_DEFINITION.name, "analytics_get_drawdowns");
  assert.equal(TOOL_DEFINITION.inputSchema.type, "object");
  assert.equal(TOOL_DEFINITION.inputSchema.additionalProperties, false);
  assert.deepEqual(TOOL_DEFINITION.inputSchema.required, ["code", "market", "endDate"]);
  assert.deepEqual(TOOL_DEFINITION.inputSchema.properties.period.enum, ["daily", "yearly"]);
  assert.deepEqual(TOOL_DEFINITION.inputSchema.properties.priceField.enum, ["open", "close", "high", "low"]);
  assert.equal(TOOL_DEFINITION.annotations.readOnlyHint, true);
  assert.equal(TOOL_DEFINITION.annotations.destructiveHint, false);
  assert.equal(TOOL_DEFINITION.annotations.idempotentHint, true);
  assert.equal(TOOL_DEFINITION.annotations.openWorldHint, false);
});

test("drawdowns MCP handler delegates unchanged input to the application use case", async () => {
  const calls = [];
  const expected = useCaseResult();
  const tool = createAnalyticsGetDrawdownsTool({
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
    startDate: "2026-01-01",
    endDate: "2026-08-12",
    period: "daily",
    minDrawdown: 0.2,
    priceField: "close",
  };
  const result = await tool.handler(input);

  assert.deepEqual(calls, [input]);
  assert.deepEqual(result.structuredContent, expected);
  assert.deepEqual(JSON.parse(result.content[0].text), expected);
  assert.equal(result.content[0].type, "text");
  assert.equal(result.isError, undefined);
});

test("drawdowns MCP handler maps application errors to MCP tool errors", async () => {
  const tool = createAnalyticsGetDrawdownsTool({
    useCase: {
      async execute() {
        throw new TypeError("endDate must use YYYY-MM-DD.");
      },
    },
  });

  const result = await tool.handler({ code: "600001", market: 1, endDate: "bad" });
  assert.equal(result.isError, true);
  assert.deepEqual(result.structuredContent, {
    error: {
      code: "invalid_arguments",
      message: "endDate must use YYYY-MM-DD.",
    },
  });
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
});

test("drawdowns MCP handler preserves explicit domain error codes without leaking stack data", async () => {
  const tool = createAnalyticsGetDrawdownsTool({
    useCase: {
      async execute() {
        const error = new Error("Kline history is unavailable.");
        error.code = "market_data_unavailable";
        throw error;
      },
    },
  });

  const result = await tool.handler({ code: "600001", market: 1, endDate: "2026-08-12" });
  assert.deepEqual(result.structuredContent, {
    error: {
      code: "market_data_unavailable",
      message: "Kline history is unavailable.",
    },
  });
  assert.equal(result.content[0].text.includes("stack"), false);
});

test("drawdowns MCP tool requires an application use case instead of constructing business dependencies", () => {
  assert.throws(() => createAnalyticsGetDrawdownsTool(), /useCase/);
  assert.throws(() => createAnalyticsGetDrawdownsTool({ useCase: {} }), /execute/);
});
