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

test("MCP composition root keeps KlineReader and StrategyReader as separate shared boundaries", async () => {
  const klineCalls = [];
  const strategyCalls = [];
  const klineReader = {
    async readRange(input) {
      klineCalls.push(input);
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
  const strategyReader = {
    async listStrategies(input) {
      strategyCalls.push(input);
      return {
        strategies: [{
          id: "example",
          name: "Example",
          description: null,
          isSystem: true,
          archived: false,
          status: "ready",
          schemaVersion: 3,
          type: "capability_composite",
          indicatorCount: 0,
          ruleCount: 1,
        }],
        source: { kind: "fake_strategy_catalog", schemaVersion: 3 },
      };
    },
  };

  const { registry } = createMcpCompositionRoot({ klineReader, strategyReader });
  assert.deepEqual(registry.listDefinitions().map((definition) => definition.name), [
    "analytics_get_bollinger",
    "analytics_get_drawdowns",
    "analytics_get_recovery_periods",
    "market_get_kline",
    "market_get_summary",
    "strategy_list",
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
  const summaryResult = await registry.invoke("market_get_summary", {
    code: "600001",
    market: 1,
    startDate: "2026-01-02",
    endDate: "2026-01-06",
    period: "daily",
    adjustment: "ledger_default",
  });
  const bollingerResult = await registry.invoke("analytics_get_bollinger", {
    code: "600001",
    market: 1,
    startDate: "2026-01-02",
    endDate: "2026-01-06",
    window: 2,
    points: 2,
  });
  const drawdownResult = await registry.invoke("analytics_get_drawdowns", {
    code: "600001",
    market: 1,
    startDate: "2026-01-02",
    endDate: "2026-01-06",
    minDrawdown: 0.2,
    priceField: "close",
  });
  const recoveryResult = await registry.invoke("analytics_get_recovery_periods", {
    code: "600001",
    market: 1,
    startDate: "2026-01-02",
    endDate: "2026-01-06",
    minDrawdown: 0.2,
    priceField: "close",
  });
  const strategyResult = await registry.invoke("strategy_list", { includeDefinition: false });

  assert.deepEqual(klineCalls, [
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
    {
      code: "600001",
      market: 1,
      startDate: "2026-01-02",
      endDate: "2026-01-06",
      period: "daily",
      limit: null,
    },
    {
      code: "600001",
      market: 1,
      startDate: "2026-01-02",
      endDate: "2026-01-06",
      period: "daily",
      limit: null,
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
  assert.deepEqual(strategyCalls, [{ includeDefinition: false }]);
  assert.equal(marketResult.isError, undefined);
  assert.deepEqual(marketResult.structuredContent.bars.map((bar) => bar.date), ["2026-01-05", "2026-01-06"]);
  assert.equal(marketResult.structuredContent.page.hasMore, true);
  assert.equal(summaryResult.isError, undefined);
  assert.deepEqual(summaryResult.structuredContent.latest, { date: "2026-01-06", close: 100 });
  assert.equal(summaryResult.structuredContent.coverage.barCount, 3);
  assert.equal(summaryResult.structuredContent.range.returnRate, 0);
  assert.equal(bollingerResult.isError, undefined);
  assert.deepEqual(bollingerResult.structuredContent.points.map((point) => point.date), ["2026-01-05", "2026-01-06"]);
  assert.equal(bollingerResult.structuredContent.latest.middle, 90);
  assert.equal(drawdownResult.isError, undefined);
  assert.equal(drawdownResult.structuredContent.summary.eventCount, 1);
  assert.equal(drawdownResult.structuredContent.events[0].drawdown, -0.2);
  assert.equal(drawdownResult.structuredContent.events[0].status, "recovered");
  assert.equal(recoveryResult.isError, undefined);
  assert.equal(recoveryResult.structuredContent.summary.recoveredCount, 1);
  assert.equal(recoveryResult.structuredContent.periods[0].declineTradingDays, 1);
  assert.equal(recoveryResult.structuredContent.periods[0].recoveryTradingDays, 1);
  assert.equal(recoveryResult.structuredContent.periods[0].underwaterTradingDays, 2);
  assert.equal(strategyResult.isError, undefined);
  assert.equal(strategyResult.structuredContent.summary.count, 1);
  assert.equal(strategyResult.structuredContent.strategies[0].id, "example");
});

test("MCP composition root accepts prebuilt tools without constructing domain dependencies", async () => {
  const bollingerTool = fakeTool("injected_bollinger", async () => ({ content: [], structuredContent: { ok: true } }));
  const drawdownsTool = fakeTool("injected_drawdowns", async () => ({ content: [], structuredContent: { ok: true } }));
  const recoveryPeriodsTool = fakeTool("injected_recovery", async () => ({ content: [], structuredContent: { ok: true } }));
  const marketKlineTool = fakeTool("injected_kline", async () => ({ content: [], structuredContent: { ok: true } }));
  const marketSummaryTool = fakeTool("injected_summary", async () => ({ content: [], structuredContent: { ok: true } }));
  const strategyListTool = fakeTool("injected_strategy_list", async () => ({ content: [], structuredContent: { ok: true } }));
  const { registry } = createMcpCompositionRoot({
    bollingerTool,
    drawdownsTool,
    recoveryPeriodsTool,
    marketKlineTool,
    marketSummaryTool,
    strategyListTool,
  });

  assert.deepEqual(registry.listDefinitions(), [
    bollingerTool.definition,
    drawdownsTool.definition,
    recoveryPeriodsTool.definition,
    marketKlineTool.definition,
    marketSummaryTool.definition,
    strategyListTool.definition,
  ]);
  for (const name of [
    "injected_bollinger",
    "injected_drawdowns",
    "injected_recovery",
    "injected_kline",
    "injected_summary",
    "injected_strategy_list",
  ]) {
    assert.deepEqual(await registry.invoke(name), {
      content: [],
      structuredContent: { ok: true },
    });
  }
});
