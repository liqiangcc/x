"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  TOOL_DEFINITION,
  createMarketGetKlineTool,
} = require("../src/adapters/mcp/tools/market_get_kline");

function useCaseResult() {
  return {
    security: { code: "600001", market: 1 },
    period: "daily",
    startDate: "2026-01-01",
    endDate: "2026-08-12",
    adjustment: "ledger_default",
    bars: [{
      date: "2026-08-12",
      open: 10,
      close: 11,
      high: 12,
      low: 9,
      volume: 1000,
      amount: 10000,
      changePct: 1.2,
    }],
    page: {
      limit: 200,
      returnedBars: 1,
      hasMore: false,
      nextEndDate: null,
    },
    meta: {
      dataMode: "legacy_approximate",
      priceView: "legacy_forward_adjusted",
      qualityIssues: [],
      source: { kind: "repo_ledger", contentHash: "hash", path: "data/kline/daily/600/600001.json" },
    },
  };
}

test("market kline MCP definition is bounded, read-only, and explicit about adjustment", () => {
  assert.equal(TOOL_DEFINITION.name, "market_get_kline");
  assert.equal(TOOL_DEFINITION.inputSchema.type, "object");
  assert.equal(TOOL_DEFINITION.inputSchema.additionalProperties, false);
  assert.deepEqual(TOOL_DEFINITION.inputSchema.required, ["code", "market", "endDate"]);
  assert.deepEqual(TOOL_DEFINITION.inputSchema.properties.period.enum, ["daily", "yearly"]);
  assert.equal(TOOL_DEFINITION.inputSchema.properties.limit.maximum, 500);
  assert.deepEqual(TOOL_DEFINITION.inputSchema.properties.adjustment.enum, ["ledger_default"]);
  assert.equal(TOOL_DEFINITION.annotations.readOnlyHint, true);
  assert.equal(TOOL_DEFINITION.annotations.destructiveHint, false);
  assert.equal(TOOL_DEFINITION.annotations.idempotentHint, true);
  assert.equal(TOOL_DEFINITION.annotations.openWorldHint, false);
});

test("market kline MCP handler delegates unchanged input to the application use case", async () => {
  const calls = [];
  const expected = useCaseResult();
  const tool = createMarketGetKlineTool({
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
    limit: 50,
    adjustment: "ledger_default",
  };

  const result = await tool.handler(input);

  assert.deepEqual(calls, [input]);
  assert.deepEqual(result.structuredContent, expected);
  assert.deepEqual(JSON.parse(result.content[0].text), expected);
  assert.equal(result.isError, undefined);
});

test("market kline MCP handler uses shared stable error mapping", async () => {
  const tool = createMarketGetKlineTool({
    useCase: {
      async execute() {
        throw new TypeError("limit must be an integer between 1 and 500.");
      },
    },
  });

  const result = await tool.handler({ code: "600001", market: 1, endDate: "2026-08-12", limit: 999 });
  assert.equal(result.isError, true);
  assert.deepEqual(result.structuredContent, {
    error: {
      code: "invalid_arguments",
      message: "limit must be an integer between 1 and 500.",
    },
  });
  assert.equal(result.content[0].text.includes("stack"), false);
});

test("market kline MCP tool requires an application use case instead of reading the ledger itself", () => {
  assert.throws(() => createMarketGetKlineTool(), /useCase/);
  assert.throws(() => createMarketGetKlineTool({ useCase: {} }), /execute/);
});
