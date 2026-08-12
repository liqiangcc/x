"use strict";

const { LedgerKlineReader } = require("../ledger/ledger_kline_reader");
const { AnalyzeDrawdownsUseCase } = require("../../application/analytics/analyze_drawdowns");
const { createAnalyticsGetDrawdownsTool } = require("./tools/analytics_get_drawdowns");
const { McpToolRegistry } = require("./tool_registry");

function createMcpCompositionRoot({
  klineReader = null,
  drawdownsUseCase = null,
  drawdownsTool = null,
  registry = null,
} = {}) {
  const resolvedRegistry = registry ?? new McpToolRegistry();
  if (!(resolvedRegistry instanceof McpToolRegistry) && typeof resolvedRegistry.register !== "function") {
    throw new TypeError("registry must provide register().");
  }

  let resolvedTool = drawdownsTool;
  if (!resolvedTool) {
    let resolvedUseCase = drawdownsUseCase;
    if (!resolvedUseCase) {
      const resolvedKlineReader = klineReader ?? new LedgerKlineReader();
      resolvedUseCase = new AnalyzeDrawdownsUseCase({ klineReader: resolvedKlineReader });
    }
    resolvedTool = createAnalyticsGetDrawdownsTool({ useCase: resolvedUseCase });
  }

  resolvedRegistry.register(resolvedTool);
  return Object.freeze({ registry: resolvedRegistry });
}

module.exports = {
  createMcpCompositionRoot,
};
