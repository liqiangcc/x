"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  TOOL_DEFINITION,
  createMarketGetSummaryTool,
} = require("../src/adapters/mcp/tools/market_get_summary");

function useCaseResult() {
  return {
    security: { code: "600001", market: 1 },
    period: "daily",
    startDate: "2026-01-01",
    endDate: "2026-08-12",
    adjustment: "ledger_default",
    latest: { date: "2026-08-12", close: 11 },
    range: {
      firstDate: "2026-01-02",
      lastDate: "2026-08-12",
      firstClose: 10,
      lastClose: 11,
      returnRate: 0.1,
      high: { date: "2026-07-01", price: 12 },
      low: { date: "2026-02-01", price: 8 },
    },
    coverage: {
      requestedStartDate: "2026-01-01",
      requestedEndDate: "2026-08-12",
      observedStartDate: "2026-01-02",
      observedEndDate: "2026-08-12",
      barCount: 150,
    },
    meta: {
      dataMode: "legacy_approximate",
      priceView: "legacy_forward_adjusted",
      qualityIssues: [],
      source: { kind: "repo_ledger", contentHash: "hash", path: "data/kline/daily/600/600001.json" },
    },
  };
}

test("market summary MCP definition is compact, read-only, and explicit about adjustment", () => {
  assert.equal(TOOL_DEFINITION.name, "market_get_summary");
  assert.equal(TOOL_DEFINITION.inputSchema.type, "object");
  assert.equal(TOOL_DEFINITION.inputSchema.additionalProperties, false);
  assert.deepEqual(TOOL_DEFINITION.inputSchema.required, ["code", "market", "endDate"]);
  assert.deepEqual(TOOL_DEFINITION.inputSchema.properties.period.enum, ["daily", "yearly"]);
  assert.deepEqual(TOOL_DEFINITION.inputSchema.properties.adjustment.enum, ["ledger_default"]);
  assert.equal(TOOL_DEFINITION.inputSchema.properties.limit, undefined);
  assert.equal(TOOL_DEFINITION.annotations.readOnlyHint, true);
  assert.equal(TOOL_DEFINITION.annotations.destructiveHint, false);
  assert.equal(TOOL_DEFINITION.annotations.idempotentHint, true);
  assert.equal(TOOL_DEFINITION.annotations.openWorldHint, false);
});

test("market summary MCP handler delegates unchanged input to the application use case", async () => {
  const calls = [];
  const expected = useCaseResult();
  const tool = createMarketGetSummaryTool({
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
    adjustment: "ledger_default",
  };

  const result = await tool.handler(input);

  assert.deepEqual(calls, [input]);
  assert.deepEqual(result.structuredContent, expected);
  assert.deepEqual(JSON.parse(result.content[0].text), expected);
  assert.equal(result.isError, undefined);
});

test("market summary MCP handler uses shared stable error mapping", async () => {
  const tool = createMarketGetSummaryTool({
    useCase: {
      async execute() {
        throw new TypeError("adjustment must be ledger_default.");
      },
    },
  });

  const result = await tool.handler({
    code: "600001",
    market: 1,
    endDate: "2026-08-12",
    adjustment: "raw",
  });
  assert.equal(result.isError, true);
  assert.deepEqual(result.structuredContent, {
    error: {
      code: "invalid_arguments",
      message: "adjustment must be ledger_default.",
    },
  });
  assert.equal(result.content[0].text.includes("stack"), false);
});

test("market summary MCP tool requires an application use case instead of reading the ledger itself", () => {
  assert.throws(() => createMarketGetSummaryTool(), /useCase/);
  assert.throws(() => createMarketGetSummaryTool({ useCase: {} }), /execute/);
});
