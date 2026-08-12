"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createMcpCompositionRoot,
} = require("../src/adapters/mcp/composition_root");
const {
  createFrictionlessBuyExecutionModel,
} = require("../src/simulation/execution/frictionless_buy_execution_model");

function fakeTool(name) {
  return Object.freeze({
    definition: Object.freeze({
      name,
      description: `${name} test tool`,
      inputSchema: Object.freeze({ type: "object" }),
    }),
    async handler() {
      return { content: [], structuredContent: { ok: true } };
    },
  });
}

function bar(date, open, close = open) {
  return {
    date,
    open,
    close,
    high: open * 1.05,
    low: open * 0.95,
    volume: 1000,
  };
}

test("composition root can select frictionless execution without changing the simulation use case or MCP tool", async () => {
  const factoryCalls = [];
  const root = createMcpCompositionRoot({
    klineReader: {
      async readRange() {
        return {
          security: { code: "600001", market: 1 },
          period: "daily",
          startDate: "2026-01-02",
          endDate: "2026-01-06",
          bars: [
            bar("2026-01-02", 10),
            bar("2026-01-05", 9),
            bar("2026-01-06", 10),
          ],
          dataMode: "test",
          priceView: "raw",
          qualityIssues: [],
          source: { kind: "test" },
        };
      },
    },
    simulationExecutionModelFactory(input) {
      factoryCalls.push(input);
      return createFrictionlessBuyExecutionModel(input);
    },
    bollingerTool: fakeTool("injected_bollinger"),
    drawdownsTool: fakeTool("injected_drawdowns"),
    recoveryPeriodsTool: fakeTool("injected_recovery"),
    marketKlineTool: fakeTool("injected_kline"),
    marketSummaryTool: fakeTool("injected_summary"),
    strategyExplainTool: fakeTool("injected_strategy_explain"),
    strategyCandidatesTool: fakeTool("injected_strategy_candidates"),
    strategyListTool: fakeTool("injected_strategy_list"),
  });

  const result = await root.registry.invoke("simulation_run_drawdown_buying", {
    code: "600001",
    market: 1,
    startDate: "2026-01-02",
    endDate: "2026-01-06",
    period: "daily",
    initialCapital: 10000,
    initialDrawdown: 0,
    drawdownStep: 0.08,
    trancheFraction: 0.5,
    maxPurchases: 1,
    lotSize: 100,
    priceField: "close",
  });

  assert.equal(result.isError, undefined);
  assert.deepEqual(factoryCalls, [{ executionConfig: { lotSize: 100 } }]);
  assert.equal(result.structuredContent.meta.execution.kind, "frictionless_next_open");
  assert.equal(result.structuredContent.meta.execution.feesIncluded, false);
  assert.equal(result.structuredContent.meta.execution.slippageIncluded, false);
  assert.equal(result.structuredContent.meta.execution.marketRestrictionsIncluded, false);
  assert.equal(result.structuredContent.summary.portfolio.totalFees, 0);
  assert.equal(result.structuredContent.summary.portfolio.totalSlippage, 0);
});
