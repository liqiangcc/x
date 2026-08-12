"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  TOOL_DEFINITION,
  createSimulationRunDrawdownBuyingTool,
} = require("../src/adapters/mcp/tools/simulation_run_drawdown_buying");

function useCaseResult() {
  return {
    security: { code: "600001", market: 1 },
    period: "daily",
    startDate: "2026-01-01",
    endDate: "2026-08-12",
    config: {
      initialDrawdown: 0,
      drawdownStep: 0.08,
      trancheFraction: 0.1,
      maxPurchases: 10,
      priceField: "close",
      initialCapital: 100000,
      lotSize: 1,
    },
    signals: [{
      index: 1,
      type: "initial_entry",
      date: "2026-01-02",
      price: 10,
      referenceDate: "2026-01-02",
      referencePrice: 10,
      triggerPrice: 10,
      drawdownFromReference: 0,
      allocationFraction: 0.1,
    }],
    trades: [{
      index: 1,
      date: "2026-01-02",
      status: "filled",
      requestedBudget: 10000,
      effectiveBudget: 10000,
      price: 10,
      quantity: 1000,
      totalCost: 10000,
      metadata: { signalIndex: 1 },
    }],
    summary: {
      policy: { signalCount: 1 },
      portfolio: {
        initialCash: 100000,
        filledTradeCount: 1,
        skippedTradeCount: 0,
        investedAmount: 10000,
        remainingCash: 90000,
        quantity: 1000,
        averageCost: 10,
        finalPrice: 11,
        marketValue: 11000,
        equity: 101000,
        unrealizedPnl: 1000,
        totalReturn: 0.01,
      },
    },
    meta: {
      dataMode: "legacy_approximate",
      priceView: "legacy_forward_adjusted",
      qualityIssues: [],
      source: { kind: "repo_ledger", contentHash: "hash", path: "data/kline/daily/600/600001.json" },
      execution: {
        lotSize: 1,
        priceField: "close",
        feesIncluded: false,
        slippageIncluded: false,
      },
    },
  };
}

test("drawdown buying MCP definition is bounded, read-only, and explicit about execution assumptions", () => {
  assert.equal(TOOL_DEFINITION.name, "simulation_run_drawdown_buying");
  assert.equal(TOOL_DEFINITION.inputSchema.type, "object");
  assert.equal(TOOL_DEFINITION.inputSchema.additionalProperties, false);
  assert.deepEqual(TOOL_DEFINITION.inputSchema.required, ["code", "market", "endDate"]);
  assert.deepEqual(TOOL_DEFINITION.inputSchema.properties.period.enum, ["daily"]);
  assert.equal(TOOL_DEFINITION.inputSchema.properties.maxPurchases.maximum, 100);
  assert.equal(TOOL_DEFINITION.inputSchema.properties.lotSize.minimum, 1);
  assert.deepEqual(TOOL_DEFINITION.inputSchema.properties.priceField.enum, ["open", "close", "high", "low"]);
  assert.match(TOOL_DEFINITION.description, /excludes fees and slippage/);
  assert.equal(TOOL_DEFINITION.annotations.readOnlyHint, true);
  assert.equal(TOOL_DEFINITION.annotations.destructiveHint, false);
  assert.equal(TOOL_DEFINITION.annotations.idempotentHint, true);
  assert.equal(TOOL_DEFINITION.annotations.openWorldHint, false);
});

test("drawdown buying MCP handler delegates unchanged input to the application use case", async () => {
  const calls = [];
  const expected = useCaseResult();
  const tool = createSimulationRunDrawdownBuyingTool({
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
    initialCapital: 100000,
    initialDrawdown: 0.2,
    drawdownStep: 0.08,
    trancheFraction: 0.1,
    maxPurchases: 8,
    lotSize: 100,
    priceField: "close",
  };
  const result = await tool.handler(input);

  assert.deepEqual(calls, [input]);
  assert.deepEqual(result.structuredContent, expected);
  assert.deepEqual(JSON.parse(result.content[0].text), expected);
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.meta.execution.feesIncluded, false);
  assert.equal(result.structuredContent.meta.execution.slippageIncluded, false);
});

test("drawdown buying MCP handler maps application errors to stable tool errors", async () => {
  const tool = createSimulationRunDrawdownBuyingTool({
    useCase: {
      async execute() {
        throw new TypeError("trancheFraction * maxPurchases must not exceed 1.");
      },
    },
  });

  const result = await tool.handler({ code: "600001", market: 1, endDate: "2026-08-12" });
  assert.equal(result.isError, true);
  assert.deepEqual(result.structuredContent, {
    error: {
      code: "invalid_arguments",
      message: "trancheFraction * maxPurchases must not exceed 1.",
    },
  });
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
});

test("drawdown buying MCP tool requires the application use case instead of owning business dependencies", () => {
  assert.throws(() => createSimulationRunDrawdownBuyingTool(), /useCase/);
  assert.throws(() => createSimulationRunDrawdownBuyingTool({ useCase: {} }), /execute/);
});
