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

test("stdio MCP client runs execution-aware drawdown buying simulation through the real ledger composition", { timeout: 20_000 }, async () => {
  const repositoryRoot = path.resolve(__dirname, "..");
  const client = new Client(
    { name: "x-mcp-simulation-stdio-e2e", version: "0.1.0" },
    { versionNegotiation: { mode: "auto" } }
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(repositoryRoot, "src/adapters/mcp/stdio_entry.js")],
    cwd: repositoryRoot,
  });

  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const simulation = listed.tools.find((tool) => tool.name === "simulation_run_drawdown_buying");
    assert.ok(simulation, "simulation_run_drawdown_buying must be discoverable over real stdio MCP");
    assert.equal(simulation.annotations?.readOnlyHint, true);
    assert.equal(simulation.annotations?.destructiveHint, false);
    assert.equal(simulation.annotations?.idempotentHint, true);
    assert.deepEqual(simulation.inputSchema.required, ["code", "market", "endDate"]);
    assert.deepEqual(simulation.inputSchema.properties.period.enum, ["daily"]);
    assert.equal(simulation.inputSchema.properties.drawdownStep.default, 0.08);
    assert.equal(simulation.inputSchema.properties.trancheFraction.default, 0.1);
    assert.equal(simulation.inputSchema.properties.lotSize.default, 100);

    // Keep the test inside the checked-in ledger fixture rather than implying
    // that the repository contains current market data.
    const result = await client.callTool({
      name: "simulation_run_drawdown_buying",
      arguments: {
        code: "600001",
        market: 1,
        startDate: "2009-01-01",
        endDate: "2009-12-15",
        period: "daily",
        initialCapital: 100000,
        initialDrawdown: 0,
        drawdownStep: 0.08,
        trancheFraction: 0.1,
        maxPurchases: 10,
        lotSize: 100,
        priceField: "close",
      },
    });

    assert.notEqual(result.isError, true);
    const payload = structuredPayload(result);
    assert.equal(payload.security.code, "600001");
    assert.equal(payload.security.market, 1);
    assert.equal(payload.period, "daily");
    assert.equal(payload.startDate, "2009-01-01");
    assert.equal(payload.endDate, "2009-12-15");
    assert.equal(payload.config.initialCapital, 100000);
    assert.equal(payload.config.drawdownStep, 0.08);
    assert.equal(payload.config.trancheFraction, 0.1);
    assert.equal(payload.config.maxPurchases, 10);
    assert.equal(payload.config.lotSize, 100);
    assert.ok(payload.signals.length >= 1);
    assert.equal(payload.signals[0].type, "initial_entry");
    assert.equal(payload.trades.length, payload.signals.length);
    assert.ok(payload.summary.portfolio.filledTradeCount >= 1);
    assert.ok(payload.summary.portfolio.filledTradeCount <= payload.config.maxPurchases);
    assert.equal(typeof payload.summary.portfolio.totalReturn, "number");
    assert.ok(payload.summary.portfolio.totalFees > 0);
    assert.ok(payload.summary.portfolio.totalSlippage >= 0);

    const firstFill = payload.trades.find((trade) => trade.status === "filled");
    assert.ok(firstFill, "at least one signal must execute in the checked-in fixture");
    assert.ok(firstFill.executionDate > firstFill.signalDate, "execution must occur after the signal bar");
    assert.ok(firstFill.feeAmount > 0);
    assert.ok(firstFill.quantity % 100 === 0);

    assert.equal(payload.meta.source.kind, "repo_ledger");
    assert.ok(payload.meta.source.contentHash);
    assert.match(
      payload.meta.source.path,
      /data[\\/]kline[\\/]daily[\\/]600[\\/]600001\.json$/
    );
    assert.equal(payload.meta.execution.priceField, "close");
    assert.equal(payload.meta.execution.signalPriceField, "close");
    assert.equal(payload.meta.execution.executionPriceField, "open");
    assert.equal(payload.meta.execution.timing, "next_trading_day_open");
    assert.equal(payload.meta.execution.lotSize, 100);
    assert.equal(payload.meta.execution.feesIncluded, true);
    assert.equal(payload.meta.execution.slippageIncluded, true);
    assert.equal(payload.meta.execution.marketRestrictionsIncluded, true);
    assert.ok(payload.meta.execution.qualityIssues.includes("historical_fee_rules_unavailable"));
    assert.ok(payload.meta.execution.qualityIssues.includes("market_rule_approximation"));
  } finally {
    await client.close();
  }
});
