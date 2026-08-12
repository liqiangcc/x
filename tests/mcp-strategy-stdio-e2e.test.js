"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { Client } = require("@modelcontextprotocol/client");
const { StdioClientTransport } = require("@modelcontextprotocol/client/stdio");

function structuredPayload(result) {
  if (result?.structuredContent && typeof result.structuredContent === "object") {
    return result.structuredContent;
  }
  const text = result?.content?.find((item) => item?.type === "text")?.text;
  if (typeof text !== "string") throw new TypeError("MCP tool result has no structuredContent or text payload.");
  return JSON.parse(text);
}

test("stdio MCP strategy_list reads the real builtin strategy catalog through StrategyReader", { timeout: 20_000 }, async () => {
  const repositoryRoot = path.resolve(__dirname, "..");
  const client = new Client(
    { name: "x-mcp-strategy-e2e", version: "0.1.0" },
    { versionNegotiation: { mode: "auto" } }
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(repositoryRoot, "src/adapters/mcp/stdio_entry.js")],
    cwd: repositoryRoot,
  });

  try {
    await client.connect(transport);
    assert.equal(client.getProtocolEra(), "modern");

    const listed = await client.listTools();
    const strategyList = listed.tools.find((tool) => tool.name === "strategy_list");
    assert.ok(strategyList, "strategy_list must be discoverable over real stdio MCP");
    assert.equal(strategyList.annotations?.readOnlyHint, true);
    assert.equal(strategyList.inputSchema.additionalProperties, false);
    assert.equal(strategyList.inputSchema.properties.includeDefinition.default, false);

    const compactResult = await client.callTool({
      name: "strategy_list",
      arguments: {},
    });
    assert.notEqual(compactResult.isError, true);
    const compact = structuredPayload(compactResult);
    assert.ok(compact.summary.count > 0);
    assert.equal(compact.summary.systemCount, compact.summary.count);
    assert.equal(compact.summary.archivedCount, 0);
    assert.equal(compact.meta.source.kind, "builtin_strategy_catalog");
    const builtin = compact.strategies.find((item) => item.id === "three_year_decline_breakout");
    assert.ok(builtin, "three_year_decline_breakout must be present in the builtin catalog");
    assert.equal(builtin.isSystem, true);
    assert.equal(builtin.definition, undefined);
    assert.ok(builtin.ruleCount > 0);

    const detailedResult = await client.callTool({
      name: "strategy_list",
      arguments: { includeDefinition: true },
    });
    assert.notEqual(detailedResult.isError, true);
    const detailed = structuredPayload(detailedResult);
    const detailedBuiltin = detailed.strategies.find((item) => item.id === "three_year_decline_breakout");
    assert.ok(detailedBuiltin?.definition);
    assert.equal(detailedBuiltin.definition.schemaVersion, detailedBuiltin.schemaVersion);
    assert.equal(Array.isArray(detailedBuiltin.definition.rules), true);
    assert.equal(detailedBuiltin.definition.rules.length, detailedBuiltin.ruleCount);
  } finally {
    await client.close();
  }
});
