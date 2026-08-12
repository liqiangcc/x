"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  McpToolRegistry,
  assertMcpTool,
} = require("../src/adapters/mcp/tool_registry");
const { createMcpCompositionRoot } = require("../src/adapters/mcp/composition_root");

function fakeTool(name = "example_tool", handler = async (input) => ({ input })) {
  return {
    definition: { name, description: `${name} description`, inputSchema: { type: "object" } },
    handler,
  };
}

function klineBar(date, close) {
  return {
    date,
    open: close,
    close,
    high: close,
    low: close,
    volume: 1000,
    amount: 10000,
    changePct: 0,
  };
}

test("MCP tool registry owns registration and invocation only", async () => {
  const calls = [];
  const tool = fakeTool("example_tool", async (input) => {
    calls.push(input);
    return { ok: true };
  });
  const registry = new McpToolRegistry({ tools: [tool] });

  assert.equal(assertMcpTool(tool), tool);
  assert.equal(registry.has("example_tool"), true);
  assert.equal(registry.get("example_tool"), tool);
  assert.deepEqual(registry.listDefinitions(), [tool.definition]);
  assert.deepEqual(await registry.invoke("example_tool", { value: 1 }), { ok: true });
  assert.deepEqual(calls, [{ value: 1 }]);
});

test("MCP tool registry rejects malformed, duplicate, and unknown tools", async () => {
  assert.throws(() => new McpToolRegistry({ tools: {} }), /array/);
  assert.throws(() => assertMcpTool(null), /object/);
  assert.throws(() => assertMcpTool({ definition: { name: "x" } }), /handler/);

  const registry = new McpToolRegistry();
  registry.register(fakeTool("same"));
  assert.throws(
    () => registry.register(fakeTool("same")),
    (error) => error.code === "duplicate_mcp_tool"
  );
  await assert.rejects(
    () => registry.invoke("missing", {}),
    (error) => error.code === "unknown_mcp_tool"
  );
});

test("MCP composition root shares one KlineReader across market and analytics use cases", async () => {
  const calls = [];
  const klineReader = {
    async readRange(input) {
      calls.push(input);
      return {
        security: { code: "600001", market: 1 },
        period: "daily",
        startDate: "2026-01-02",
        endDate: "2026-01-06",
        bars: [
          klineBar("2026-01-02", 100),
          klineBar("2026-01-05", 80),
          klineBar("2026-01-06", 100),
        ],
        dataMode: "legacy_approximate",
        priceView: "legacy_forward_adjusted",
        qualityIssues: [],
        source: { kind: "test", contentHash: null, path: null },
      };
    },
  };

  const { registry } = createMcpCompositionRoot({ klineReader });
  assert.deepEqual(registry.listDefinitions().map((definition) => definition.name), [
    "analytics_get_drawdowns",
    "market_get_kline",
  ]);

  const marketResult = await registry.invoke("market_get_kline", {
    code: "600001",
    market: 1,
    startDate: "2026-01-02",
    endDate: "2026-01-06",
    period: "daily",
    limit: 2,
    adjustment: "ledger_default",
  });
  const drawdownResult = await registry.invoke("analytics_get_drawdowns", {
    code: "600001",
    market: 1,
    startDate: "2026-01-02",
    endDate: "2026-01-06",
    minDrawdown: 0.2,
    priceField: "close",
  });

  assert.deepEqual(calls, [
    {
      code: "600001",
      market: 1,
      startDate: "2026-01-02",
      endDate: "2026-01-06",
      period: "daily",
      limit: 3,
    },
    {
      code: "600001",
      market: 1,
      startDate: "2026-01-02",
      endDate: "2026-01-06",
      period: "daily",
      limit: null,
    },
  ]);
  assert.equal(marketResult.isError, undefined);
  assert.deepEqual(marketResult.structuredContent.bars.map((bar) => bar.date), ["2026-01-05", "2026-01-06"]);
  assert.equal(marketResult.structuredContent.page.hasMore, true);
  assert.equal(drawdownResult.isError, undefined);
  assert.equal(drawdownResult.structuredContent.summary.eventCount, 1);
  assert.equal(drawdownResult.structuredContent.events[0].drawdown, -0.2);
  assert.equal(drawdownResult.structuredContent.events[0].status, "recovered");
});

test("MCP composition root accepts prebuilt tools without constructing business dependencies", async () => {
  const drawdownsTool = fakeTool("injected_drawdowns", async () => ({ content: [], structuredContent: { ok: true } }));
  const marketKlineTool = fakeTool("injected_kline", async () => ({ content: [], structuredContent: { ok: true } }));
  const { registry } = createMcpCompositionRoot({ drawdownsTool, marketKlineTool });

  assert.deepEqual(registry.listDefinitions(), [drawdownsTool.definition, marketKlineTool.definition]);
  assert.deepEqual(await registry.invoke("injected_drawdowns"), {
    content: [],
    structuredContent: { ok: true },
  });
  assert.deepEqual(await registry.invoke("injected_kline"), {
    content: [],
    structuredContent: { ok: true },
  });
});
