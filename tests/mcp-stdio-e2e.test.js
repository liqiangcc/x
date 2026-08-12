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

test("stdio MCP client lists and calls real ledger-backed market and analytics tools", { timeout: 20_000 }, async () => {
  const repositoryRoot = path.resolve(__dirname, "..");
  const client = new Client(
    { name: "x-mcp-stdio-e2e", version: "0.1.0" },
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
    const drawdowns = listed.tools.find((tool) => tool.name === "analytics_get_drawdowns");
    const marketKline = listed.tools.find((tool) => tool.name === "market_get_kline");
    assert.ok(drawdowns, "analytics_get_drawdowns must be discoverable over real stdio MCP");
    assert.ok(marketKline, "market_get_kline must be discoverable over real stdio MCP");
    assert.equal(drawdowns.annotations?.readOnlyHint, true);
    assert.equal(marketKline.annotations?.readOnlyHint, true);
    assert.deepEqual(drawdowns.inputSchema.required, ["code", "market", "endDate"]);
    assert.equal(marketKline.inputSchema.properties.limit.maximum, 500);

    // Keep the E2E window inside the checked-in ledger fixture. The sample
    // 600001 history currently ends on 2009-12-15; the test must not imply
    // that a repository fixture contains present-day market data.
    const ledgerWindow = {
      startDate: "2009-01-01",
      endDate: "2009-12-15",
    };

    const klineResult = await client.callTool({
      name: "market_get_kline",
      arguments: {
        code: "600001",
        market: 1,
        ...ledgerWindow,
        period: "daily",
        limit: 5,
        adjustment: "ledger_default",
      },
    });

    assert.notEqual(klineResult.isError, true);
    const klinePayload = structuredPayload(klineResult);
    assert.equal(klinePayload.security.code, "600001");
    assert.equal(klinePayload.security.market, 1);
    assert.equal(klinePayload.period, "daily");
    assert.equal(klinePayload.adjustment, "ledger_default");
    assert.ok(klinePayload.bars.length > 0 && klinePayload.bars.length <= 5);
    assert.equal(klinePayload.bars.at(-1)?.date, "2009-12-15");
    assert.equal(klinePayload.page.returnedBars, klinePayload.bars.length);
    assert.equal(typeof klinePayload.page.hasMore, "boolean");
    assert.equal(klinePayload.meta.source.kind, "repo_ledger");
    assert.ok(klinePayload.meta.source.contentHash);
    assert.match(
      klinePayload.meta.source.path,
      /data[\\/]kline[\\/]daily[\\/]600[\\/]600001\.json$/
    );

    const drawdownResult = await client.callTool({
      name: "analytics_get_drawdowns",
      arguments: {
        code: "600001",
        market: 1,
        ...ledgerWindow,
        period: "daily",
        minDrawdown: 0.05,
        priceField: "close",
      },
    });

    assert.notEqual(drawdownResult.isError, true);
    const drawdownPayload = structuredPayload(drawdownResult);
    assert.equal(drawdownPayload.security.code, "600001");
    assert.equal(drawdownPayload.security.market, 1);
    assert.equal(drawdownPayload.period, "daily");
    assert.equal(drawdownPayload.priceField, "close");
    assert.ok(Array.isArray(drawdownPayload.events));
    assert.ok(drawdownPayload.events.length > 0);
    assert.equal(drawdownPayload.meta.source.kind, "repo_ledger");
    assert.equal(drawdownPayload.meta.source.contentHash, klinePayload.meta.source.contentHash);
    assert.equal(drawdownPayload.meta.source.path, klinePayload.meta.source.path);
  } finally {
    await client.close();
  }
});

module.exports = {
  structuredPayload,
};
