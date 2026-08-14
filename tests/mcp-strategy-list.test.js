"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  TOOL_DEFINITION,
  createStrategyListTool,
} = require("../src/adapters/mcp/tools/strategy_list");

function useCaseResult() {
  return {
    strategies: [{
      id: "example",
      name: "Example",
      description: "Example strategy",
      isSystem: true,
      archived: false,
      status: "ready",
      schemaVersion: 3,
      type: "capability_composite",
      indicatorCount: 1,
      ruleCount: 2,
    }],
    summary: { count: 1, systemCount: 1, archivedCount: 0 },
    meta: { source: { kind: "builtin_strategy_catalog", schemaVersion: 3 } },
  };
}

test("strategy_list MCP definition is compact, read-only, and closed to extra parameters", () => {
  assert.equal(TOOL_DEFINITION.name, "strategy_list");
  assert.equal(TOOL_DEFINITION.inputSchema.type, "object");
  assert.equal(TOOL_DEFINITION.inputSchema.additionalProperties, false);
  assert.deepEqual(TOOL_DEFINITION.inputSchema.required, undefined);
  assert.equal(TOOL_DEFINITION.inputSchema.properties.includeDefinition.default, false);
  assert.equal(TOOL_DEFINITION.annotations.readOnlyHint, true);
  assert.equal(TOOL_DEFINITION.annotations.destructiveHint, false);
  assert.equal(TOOL_DEFINITION.annotations.idempotentHint, true);
  assert.equal(TOOL_DEFINITION.annotations.openWorldHint, false);
});

test("strategy_list MCP handler delegates directly to the application use case", async () => {
  const calls = [];
  const expected = useCaseResult();
  const tool = createStrategyListTool({
    useCase: {
      async execute(input) {
        calls.push(input);
        return expected;
      },
    },
  });

  const input = { includeDefinition: true };
  const result = await tool.handler(input);
  assert.deepEqual(calls, [input]);
  assert.deepEqual(result.structuredContent, expected);
  assert.deepEqual(JSON.parse(result.content[0].text), expected);
  assert.equal(result.isError, undefined);
});

test("strategy_list MCP uses shared stable error mapping", async () => {
  const tool = createStrategyListTool({
    useCase: {
      async execute() {
        throw new TypeError("includeDefinition must be a boolean.");
      },
    },
  });
  const result = await tool.handler({ includeDefinition: "yes" });
  assert.equal(result.isError, true);
  assert.deepEqual(result.structuredContent, {
    error: {
      code: "invalid_arguments",
      message: "includeDefinition must be a boolean.",
    },
  });
  assert.equal(result.content[0].text.includes("stack"), false);
});

test("strategy_list MCP requires an application use case instead of reading strategies itself", () => {
  assert.throws(() => createStrategyListTool(), /useCase/);
  assert.throws(() => createStrategyListTool({ useCase: {} }), /execute/);
});
