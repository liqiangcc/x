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

function fakeSecurityMasterSource() {
  return {
    provider: "test_provider",
    document: "security-master-test",
    version: "v1",
    collectedAt: "2026-01-01T00:00:00.000Z",
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

test("MCP composition root keeps market, temporal security classification, execution, strategy catalog, and signal storage boundaries separate", async () => {
  const klineCalls = [];
  const securityMasterCalls = [];
  const timelineCalls = [];
  const securityProfileCalls = [];
  const strategyCalls = [];
  const signalCalls = [];
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
  const securityRecord = {
    security: { code: "600001", market: 1 },
    instrumentType: "a_share",
    intradayRoundTripEligible: false,
    effectiveFrom: "2020-01-01",
    effectiveTo: null,
    source: fakeSecurityMasterSource(),
    qualityIssues: [],
  };
  const securityMasterReader = {
    readRecord(security, options) {
      securityMasterCalls.push({ method: "readRecord", security, options });
      return security.code === "600001" && security.market === 1 ? securityRecord : null;
    },
    readSnapshot() {
      securityMasterCalls.push({ method: "readSnapshot" });
      return {
        available: true,
        entries: [{ record: securityRecord, priority: 1, origin: { kind: "test" } }],
        source: { kind: "fake_security_master_snapshot" },
      };
    },
  };
  const securityMasterTimelineReader = {
    async readTimeline(security, range) {
      timelineCalls.push({ security, range });
      return {
        security,
        startDate: range.startDate,
        endDate: range.endDate,
        segments: [{
          startDate: range.startDate,
          endDate: range.endDate,
          record: securityRecord,
        }],
        gaps: [],
        source: { kind: "fake_security_master_snapshot" },
      };
    },
  };
  const simulationSecurityExecutionProfileResolver = {
    resolve(input) {
      securityProfileCalls.push(input);
      return "legacy_a_share";
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
  const signalReader = {
    async getStrategyCandidates(input) {
      signalCalls.push({ method: "getStrategyCandidates", input });
      return {
        status: "ready",
        strategyId: input.strategyId,
        date: input.date,
        build: {
          id: "build-1",
          strategyVersion: 1,
          dataVersion: "v1",
          algorithmVersion: 8,
          status: "ready",
          signalCount: 1,
        },
        candidates: [{
          rank: 1,
          securityKey: "1.600001",
          code: "600001",
          market: 1,
          rankingValues: [1],
          qualityIssues: [],
          evidence: { matched: true, rules: [{ key: "r1", ok: true }] },
        }],
        page: { offset: input.offset, limit: input.limit, returned: 1, total: 1, hasMore: false, nextOffset: null },
        source: { kind: "fake_signal_store", readonly: true },
      };
    },
    async getStrategySignal(input) {
      signalCalls.push({ method: "getStrategySignal", input });
      return {
        status: "ready",
        strategyId: input.strategyId,
        date: input.date,
        securityKey: input.securityKey,
        build: {
          id: "build-1",
          strategyVersion: 1,
          dataVersion: "v1",
          algorithmVersion: 8,
          status: "ready",
          signalCount: 1,
        },
        candidate: {
          rank: 1,
          securityKey: input.securityKey,
          code: "600001",
          market: 1,
          rankingValues: [1],
          qualityIssues: [],
          evidence: { matched: true, rules: [{ key: "r1", ok: true }] },
        },
        source: { kind: "fake_signal_store", readonly: true },
      };
    },
  };

  const { registry } = createMcpCompositionRoot({
    klineReader,
    securityMasterReader,
    securityMasterTimelineReader,
    simulationSecurityExecutionProfileResolver,
    strategyReader,
    signalReader,
  });
  assert.deepEqual(registry.listDefinitions().map((definition) => definition.name), [
    "analytics_get_bollinger",
    "analytics_get_drawdowns",
    "analytics_get_recovery_periods",
    "market_get_kline",
    "market_get_security",
    "market_get_summary",
    "simulation_run_drawdown_buying",
    "strategy_explain_signal",
    "strategy_get_candidates",
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
  const securityResult = await registry.invoke("market_get_security", {
    code: "600001",
    market: 1,
    asOf: "2026-01-06",
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
  const simulationResult = await registry.invoke("simulation_run_drawdown_buying", {
    code: "600001",
    market: 1,
    startDate: "2026-01-02",
    endDate: "2026-01-06",
    period: "daily",
    initialCapital: 100000,
    initialDrawdown: 0,
    drawdownStep: 0.2,
    trancheFraction: 0.1,
    maxPurchases: 5,
    lotSize: 1,
    priceField: "close",
  });
  const explainResult = await registry.invoke("strategy_explain_signal", {
    strategyId: "example",
    date: "2026-01-06",
    securityKey: "1.600001",
  });
  const candidateResult = await registry.invoke("strategy_get_candidates", {
    strategyId: "example",
    date: "2026-01-06",
    limit: 10,
    includeEvidence: false,
  });
  const strategyResult = await registry.invoke("strategy_list", { includeDefinition: false });

  assert.equal(klineCalls.length, 6);
  for (const call of klineCalls) {
    assert.equal(call.code, "600001");
    assert.equal(call.market, 1);
    assert.equal(call.startDate, "2026-01-02");
    assert.equal(call.endDate, "2026-01-06");
    assert.equal(call.period, "daily");
  }
  assert.deepEqual(securityMasterCalls, [{
    method: "readRecord",
    security: { code: "600001", market: 1 },
    options: { asOf: "2026-01-06" },
  }]);
  assert.deepEqual(timelineCalls, [{
    security: { code: "600001", market: 1 },
    range: { startDate: "2026-01-02", endDate: "2026-01-06" },
  }]);
  assert.deepEqual(securityProfileCalls, [{
    security: { code: "600001", market: 1 },
    metadata: {
      instrumentType: "a_share",
      intradayRoundTripEligible: false,
      effectiveFrom: "2020-01-01",
      effectiveTo: null,
      source: {
        kind: "security_master",
        provider: "test_provider",
        document: "security-master-test",
        version: "v1",
        collectedAt: "2026-01-01T00:00:00.000Z",
      },
      qualityIssues: [],
    },
  }]);
  assert.deepEqual(strategyCalls, [{ includeDefinition: false }]);
  assert.deepEqual(signalCalls, [
    {
      method: "getStrategySignal",
      input: { strategyId: "example", date: "2026-01-06", securityKey: "1.600001" },
    },
    {
      method: "getStrategyCandidates",
      input: { strategyId: "example", date: "2026-01-06", limit: 10, offset: 0 },
    },
  ]);
  assert.equal(marketResult.isError, undefined);
  assert.deepEqual(marketResult.structuredContent.bars.map((bar) => bar.date), ["2026-01-05", "2026-01-06"]);
  assert.equal(securityResult.isError, undefined);
  assert.equal(securityResult.structuredContent.security.instrumentType, "a_share");
  assert.equal(summaryResult.isError, undefined);
  assert.equal(bollingerResult.isError, undefined);
  assert.equal(drawdownResult.isError, undefined);
  assert.equal(recoveryResult.isError, undefined);
  assert.equal(simulationResult.isError, undefined);
  assert.equal(simulationResult.structuredContent.signals.length, 2);
  assert.equal(simulationResult.structuredContent.summary.portfolio.filledTradeCount, 2);
  assert.equal(simulationResult.structuredContent.config.executionModel, "legacy_a_share");
  assert.equal(simulationResult.structuredContent.config.executionModelSelection, "security_metadata_timeline");
  assert.deepEqual(simulationResult.structuredContent.meta.executionSelection, {
    mode: "security_metadata_timeline",
    profileId: "legacy_a_share",
    securityMetadataSource: "timeline",
    timeline: [{
      startDate: "2026-01-02",
      endDate: "2026-01-06",
      profileId: "legacy_a_share",
    }],
  });
  assert.equal(simulationResult.structuredContent.meta.execution.executionMode, "date_aware");
  assert.equal(simulationResult.structuredContent.meta.execution.executionModels.length, 1);
  assert.equal(simulationResult.structuredContent.meta.execution.executionModels[0].timing, "next_trading_day_open");
  assert.equal(simulationResult.structuredContent.meta.execution.executionModels[0].feesIncluded, true);
  assert.equal(simulationResult.structuredContent.meta.execution.executionModels[0].slippageIncluded, true);
  assert.equal(simulationResult.structuredContent.meta.execution.executionModels[0].marketRestrictionsIncluded, true);
  assert.equal(explainResult.isError, undefined);
  assert.equal(explainResult.structuredContent.candidate.evidence.rules[0].key, "r1");
  assert.equal(candidateResult.isError, undefined);
  assert.equal(candidateResult.structuredContent.candidates[0].code, "600001");
  assert.equal(candidateResult.structuredContent.candidates[0].evidence, undefined);
  assert.equal(strategyResult.isError, undefined);
  assert.equal(strategyResult.structuredContent.strategies[0].id, "example");
});

test("MCP composition root accepts prebuilt tools without constructing domain dependencies", async () => {
  const bollingerTool = fakeTool("injected_bollinger", async () => ({ content: [], structuredContent: { ok: true } }));
  const drawdownsTool = fakeTool("injected_drawdowns", async () => ({ content: [], structuredContent: { ok: true } }));
  const recoveryPeriodsTool = fakeTool("injected_recovery", async () => ({ content: [], structuredContent: { ok: true } }));
  const marketKlineTool = fakeTool("injected_kline", async () => ({ content: [], structuredContent: { ok: true } }));
  const marketSecurityTool = fakeTool("injected_security", async () => ({ content: [], structuredContent: { ok: true } }));
  const marketSummaryTool = fakeTool("injected_summary", async () => ({ content: [], structuredContent: { ok: true } }));
  const simulationTool = fakeTool("injected_simulation", async () => ({ content: [], structuredContent: { ok: true } }));
  const strategyExplainTool = fakeTool("injected_strategy_explain", async () => ({ content: [], structuredContent: { ok: true } }));
  const strategyCandidatesTool = fakeTool("injected_strategy_candidates", async () => ({ content: [], structuredContent: { ok: true } }));
  const strategyListTool = fakeTool("injected_strategy_list", async () => ({ content: [], structuredContent: { ok: true } }));
  const { registry } = createMcpCompositionRoot({
    bollingerTool,
    drawdownsTool,
    recoveryPeriodsTool,
    marketKlineTool,
    marketSecurityTool,
    marketSummaryTool,
    simulationTool,
    strategyExplainTool,
    strategyCandidatesTool,
    strategyListTool,
  });

  assert.deepEqual(registry.listDefinitions(), [
    bollingerTool.definition,
    drawdownsTool.definition,
    recoveryPeriodsTool.definition,
    marketKlineTool.definition,
    marketSecurityTool.definition,
    marketSummaryTool.definition,
    simulationTool.definition,
    strategyExplainTool.definition,
    strategyCandidatesTool.definition,
    strategyListTool.definition,
  ]);
  for (const name of [
    "injected_bollinger",
    "injected_drawdowns",
    "injected_recovery",
    "injected_kline",
    "injected_security",
    "injected_summary",
    "injected_simulation",
    "injected_strategy_explain",
    "injected_strategy_candidates",
    "injected_strategy_list",
  ]) {
    assert.deepEqual(await registry.invoke(name), {
      content: [],
      structuredContent: { ok: true },
    });
  }
});
