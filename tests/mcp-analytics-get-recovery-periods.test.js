"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  INPUT_SCHEMA,
  OUTPUT_SCHEMA,
  TOOL_DEFINITION,
  createAnalyticsGetRecoveryPeriodsTool,
} = require("../src/adapters/mcp/tools/analytics_get_recovery_periods");

function payload(result) {
  return result.structuredContent ?? JSON.parse(result.content[0].text);
}

test("recovery periods MCP definition is narrow, read-only, and closed to extra input", () => {
  assert.equal(TOOL_DEFINITION.name, "analytics_get_recovery_periods");
  assert.equal(TOOL_DEFINITION.annotations.readOnlyHint, true);
  assert.equal(TOOL_DEFINITION.annotations.destructiveHint, false);
  assert.equal(TOOL_DEFINITION.annotations.idempotentHint, true);
  assert.equal(TOOL_DEFINITION.annotations.openWorldHint, false);
  assert.equal(INPUT_SCHEMA.additionalProperties, false);
  assert.deepEqual(INPUT_SCHEMA.required, ["code", "market", "endDate"]);
  assert.equal(INPUT_SCHEMA.properties.minDrawdown.exclusiveMaximum, 1);
  assert.deepEqual(INPUT_SCHEMA.properties.priceField.enum, ["open", "close", "high", "low"]);
  assert.ok(OUTPUT_SCHEMA.oneOf);
});

test("recovery periods MCP handler delegates unchanged input to the application use case", async () => {
  const calls = [];
  const expected = {
    security: { code: "600001", market: 1 },
    period: "daily",
    startDate: "2026-01-01",
    endDate: "2026-06-30",
    minDrawdown: 0.2,
    priceField: "close",
    periods: [],
    summary: {
      eventCount: 0,
      recoveredCount: 0,
      ongoingCount: 0,
      averageRecoveryTradingDays: null,
      maxRecoveryTradingDays: null,
      averageUnderwaterTradingDays: null,
      maxUnderwaterTradingDays: null,
    },
    meta: {},
  };
  const tool = createAnalyticsGetRecoveryPeriodsTool({
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
    endDate: "2026-06-30",
    period: "daily",
    minDrawdown: 0.2,
    priceField: "close",
  };
  const result = await tool.handler(input);
  assert.deepEqual(calls, [input]);
  assert.deepEqual(payload(result), expected);
  assert.equal(result.isError, undefined);
});

test("recovery periods MCP handler uses shared stable error mapping", async () => {
  const error = Object.assign(new Error("bad recovery input"), { code: "INVALID_ARGUMENT", stack: "secret" });
  const tool = createAnalyticsGetRecoveryPeriodsTool({
    useCase: { async execute() { throw error; } },
  });
  const result = await tool.handler({});
  assert.equal(result.isError, true);
  assert.deepEqual(payload(result), {
    error: { code: "INVALID_ARGUMENT", message: "bad recovery input" },
  });
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("recovery periods MCP tool requires an application use case instead of reading data itself", () => {
  assert.throws(() => createAnalyticsGetRecoveryPeriodsTool(), /useCase/);
});
