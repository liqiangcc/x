"use strict";

const { LedgerKlineReader } = require("../ledger/ledger_kline_reader");
const { AnalyzeDrawdownsUseCase } = require("../../application/analytics/analyze_drawdowns");
const { GetKlineRangeUseCase } = require("../../application/market/get_kline_range");
const { createAnalyticsGetDrawdownsTool } = require("./tools/analytics_get_drawdowns");
const { createMarketGetKlineTool } = require("./tools/market_get_kline");
const { McpToolRegistry } = require("./tool_registry");

function createMcpCompositionRoot({
  klineReader = null,
  drawdownsUseCase = null,
  drawdownsTool = null,
  marketKlineUseCase = null,
  marketKlineTool = null,
  registry = null,
} = {}) {
  const resolvedRegistry = registry ?? new McpToolRegistry();
  if (!(resolvedRegistry instanceof McpToolRegistry) && typeof resolvedRegistry.register !== "function") {
    throw new TypeError("registry must provide register().");
  }

  let resolvedKlineReader = klineReader;
  const getKlineReader = () => {
    if (!resolvedKlineReader) resolvedKlineReader = new LedgerKlineReader();
    return resolvedKlineReader;
  };

  let resolvedDrawdownsTool = drawdownsTool;
  if (!resolvedDrawdownsTool) {
    const resolvedUseCase = drawdownsUseCase ?? new AnalyzeDrawdownsUseCase({
      klineReader: getKlineReader(),
    });
    resolvedDrawdownsTool = createAnalyticsGetDrawdownsTool({ useCase: resolvedUseCase });
  }

  let resolvedMarketKlineTool = marketKlineTool;
  if (!resolvedMarketKlineTool) {
    const resolvedUseCase = marketKlineUseCase ?? new GetKlineRangeUseCase({
      klineReader: getKlineReader(),
    });
    resolvedMarketKlineTool = createMarketGetKlineTool({ useCase: resolvedUseCase });
  }

  resolvedRegistry.register(resolvedDrawdownsTool);
  resolvedRegistry.register(resolvedMarketKlineTool);
  return Object.freeze({ registry: resolvedRegistry });
}

module.exports = {
  createMcpCompositionRoot,
};
