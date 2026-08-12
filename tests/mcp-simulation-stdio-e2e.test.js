"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { Client } = require("@modelcontextprotocol/client");
const { StdioClientTransport } = require("@modelcontextprotocol/client/stdio");

function structuredPayload(result) {
  if (result?.structuredContent && typeof result.structuredContent === "object") return result.structuredContent;
  const text = result?.content?.find((item) => item?.type === "text")?.text;
  if (typeof text !== "string") throw new TypeError("MCP tool result has no structuredContent or text payload.");
  return JSON.parse(text);
}

test("stdio MCP client compares stock, T+1 ETF, T+0 ETF, and frictionless execution through the real ledger composition", { timeout: 20_000 }, async () => {
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
    assert.deepEqual(simulation.inputSchema.properties.executionModel.enum, [
      "legacy_a_share",
      "domestic_stock_etf",
      "t0_etf",
      "frictionless",
    ]);
    assert.equal(simulation.inputSchema.properties.executionModel.default, "legacy_a_share");

    const commonArguments = {
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
    };
    const call = async (executionModel) => structuredPayload(await client.callTool({
      name: "simulation_run_drawdown_buying",
      arguments: { ...commonArguments, executionModel },
    }));

    const legacy = await call("legacy_a_share");
    const etf = await call("domestic_stock_etf");
    const t0Etf = await call("t0_etf");
    const frictionless = await call("frictionless");

    for (const payload of [legacy, etf, t0Etf, frictionless]) {
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
      assert.equal(payload.meta.source.kind, "repo_ledger");
      assert.ok(payload.meta.source.contentHash);
      assert.equal(payload.meta.execution.executionPriceField, "open");
      assert.equal(payload.meta.execution.timing, "next_trading_day_open");
      assert.equal(payload.meta.execution.lotSize, 100);
    }

    assert.deepEqual(etf.signals, legacy.signals);
    assert.deepEqual(t0Etf.signals, legacy.signals);
    assert.deepEqual(frictionless.signals, legacy.signals);

    assert.equal(legacy.config.executionModel, "legacy_a_share");
    assert.equal(legacy.meta.execution.kind, "legacy_a_share_next_open");
    assert.equal(legacy.meta.execution.tickSize, 0.01);
    assert.equal(legacy.meta.execution.feesIncluded, true);

    assert.equal(etf.config.executionModel, "domestic_stock_etf");
    assert.equal(etf.meta.execution.kind, "domestic_stock_etf_next_open");
    assert.equal(etf.meta.execution.tickSize, 0.001);
    assert.equal(etf.meta.execution.stampDutyRate, 0);
    assert.equal(etf.meta.execution.tPlusOne, true);
    assert.equal(etf.meta.execution.feesIncluded, true);
    assert.equal(etf.meta.execution.slippageIncluded, true);
    assert.ok(etf.meta.execution.qualityIssues.includes("etf_profile_assumes_domestic_stock_etf_t_plus_one"));
    assert.ok(etf.meta.execution.qualityIssues.includes("etf_profile_does_not_cover_t_plus_zero_etf_categories"));

    assert.equal(t0Etf.config.executionModel, "t0_etf");
    assert.equal(t0Etf.meta.execution.profileId, "t0_etf");
    assert.equal(t0Etf.meta.execution.assetClass, "t0_eligible_etf");
    assert.equal(t0Etf.meta.execution.kind, "t0_etf_next_open");
    assert.equal(t0Etf.meta.execution.tickSize, 0.001);
    assert.equal(t0Etf.meta.execution.stampDutyRate, 0);
    assert.equal(t0Etf.meta.execution.tPlusOne, false);
    assert.equal(t0Etf.meta.execution.feesIncluded, true);
    assert.equal(t0Etf.meta.execution.slippageIncluded, true);
    assert.ok(t0Etf.meta.execution.qualityIssues.includes("t0_etf_profile_requires_exchange_eligible_instrument"));
    assert.ok(t0Etf.meta.execution.qualityIssues.includes("t0_etf_profile_uses_shared_a_share_market_restriction_approximation"));

    assert.equal(frictionless.config.executionModel, "frictionless");
    assert.equal(frictionless.meta.execution.kind, "frictionless_next_open");
    assert.equal(frictionless.meta.execution.feesIncluded, false);
    assert.equal(frictionless.meta.execution.slippageIncluded, false);
    assert.equal(frictionless.summary.portfolio.totalFees, 0);
    assert.equal(frictionless.summary.portfolio.totalSlippage, 0);
  } finally {
    await client.close();
  }
});
