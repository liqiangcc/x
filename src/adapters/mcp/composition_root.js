"use strict";

const { LedgerKlineReader } = require("../ledger/ledger_kline_reader");
const { BuiltinStrategyReader } = require("../strategy/builtin_strategy_reader");
const { AnalyzeDrawdownsUseCase } = require("../../application/analytics/analyze_drawdowns");
const { AnalyzeRecoveryPeriodsUseCase } = require("../../application/analytics/analyze_recovery_periods");
const { CalculateBollingerUseCase } = require("../../application/analytics/calculate_bollinger");
const { GetKlineRangeUseCase } = require("../../application/market/get_kline_range");
const { GetMarketSummaryUseCase } = require("../../application/market/get_market_summary");
const { ListStrategiesUseCase } = require("../../application/strategy/list_strategies");
const { createAnalyticsGetBollingerTool } = require("./tools/analytics_get_bollinger");
const { createAnalyticsGetDrawdownsTool } = require("./tools/analytics_get_drawdowns");
const { createAnalyticsGetRecoveryPeriodsTool } = require("./tools/analytics_get_recovery_periods");
const { createMarketGetKlineTool } = require("./tools/market_get_kline");
const { createMarketGetSummaryTool } = require("./tools/market_get_summary");
const { createStrategyListTool } = require("./tools/strategy_list");
const { McpToolRegistry } = require("./tool_registry");

function createMcpCompositionRoot({
  klineReader = null,
  strategyReader = null,
  bollingerUseCase = null,
  bollingerTool = null,
  drawdownsUseCase = null,
  drawdownsTool = null,
  recoveryPeriodsUseCase = null,
  recoveryPeriodsTool = null,
  marketKlineUseCase = null,
  marketKlineTool = null,
  marketSummaryUseCase = null,
  marketSummaryTool = null,
  strategyListUseCase = null,
  strategyListTool = null,
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

  let resolvedStrategyReader = strategyReader;
  const getStrategyReader = () => {
    if (!resolvedStrategyReader) resolvedStrategyReader = new BuiltinStrategyReader();
    return resolvedStrategyReader;
  };

  let resolvedBollingerTool = bollingerTool;
  if (!resolvedBollingerTool) {
    const resolvedUseCase = bollingerUseCase ?? new CalculateBollingerUseCase({
      klineReader: getKlineReader(),
    });
    resolvedBollingerTool = createAnalyticsGetBollingerTool({ useCase: resolvedUseCase });
  }

  let resolvedDrawdownsTool = drawdownsTool;
  if (!resolvedDrawdownsTool) {
    const resolvedUseCase = drawdownsUseCase ?? new AnalyzeDrawdownsUseCase({
      klineReader: getKlineReader(),
    });
    resolvedDrawdownsTool = createAnalyticsGetDrawdownsTool({ useCase: resolvedUseCase });
  }

  let resolvedRecoveryPeriodsTool = recoveryPeriodsTool;
  if (!resolvedRecoveryPeriodsTool) {
    const resolvedUseCase = recoveryPeriodsUseCase ?? new AnalyzeRecoveryPeriodsUseCase({
      klineReader: getKlineReader(),
    });
    resolvedRecoveryPeriodsTool = createAnalyticsGetRecoveryPeriodsTool({ useCase: resolvedUseCase });
  }

  let resolvedMarketKlineTool = marketKlineTool;
  if (!resolvedMarketKlineTool) {
    const resolvedUseCase = marketKlineUseCase ?? new GetKlineRangeUseCase({
      klineReader: getKlineReader(),
    });
    resolvedMarketKlineTool = createMarketGetKlineTool({ useCase: resolvedUseCase });
  }

  let resolvedMarketSummaryTool = marketSummaryTool;
  if (!resolvedMarketSummaryTool) {
    const resolvedUseCase = marketSummaryUseCase ?? new GetMarketSummaryUseCase({
      klineReader: getKlineReader(),
    });
    resolvedMarketSummaryTool = createMarketGetSummaryTool({ useCase: resolvedUseCase });
  }

  let resolvedStrategyListTool = strategyListTool;
  if (!resolvedStrategyListTool) {
    const resolvedUseCase = strategyListUseCase ?? new ListStrategiesUseCase({
      strategyReader: getStrategyReader(),
    });
    resolvedStrategyListTool = createStrategyListTool({ useCase: resolvedUseCase });
  }

  resolvedRegistry.register(resolvedBollingerTool);
  resolvedRegistry.register(resolvedDrawdownsTool);
  resolvedRegistry.register(resolvedRecoveryPeriodsTool);
  resolvedRegistry.register(resolvedMarketKlineTool);
  resolvedRegistry.register(resolvedMarketSummaryTool);
  resolvedRegistry.register(resolvedStrategyListTool);
  return Object.freeze({ registry: resolvedRegistry });
}

module.exports = {
  createMcpCompositionRoot,
};
