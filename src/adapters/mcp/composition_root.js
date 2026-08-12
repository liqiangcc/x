"use strict";

const { LedgerKlineReader } = require("../ledger/ledger_kline_reader");
const { LedgerSecurityMetadataReader } = require("../ledger/ledger_security_metadata_reader");
const { BuiltinStrategyReader } = require("../strategy/builtin_strategy_reader");
const { ReadonlySqliteSignalReader } = require("../strategy/readonly_sqlite_signal_reader");
const { AnalyzeDrawdownsUseCase } = require("../../application/analytics/analyze_drawdowns");
const { AnalyzeRecoveryPeriodsUseCase } = require("../../application/analytics/analyze_recovery_periods");
const { CalculateBollingerUseCase } = require("../../application/analytics/calculate_bollinger");
const { GetKlineRangeUseCase } = require("../../application/market/get_kline_range");
const { GetMarketSummaryUseCase } = require("../../application/market/get_market_summary");
const { SimulateDrawdownBuyingUseCase } = require("../../application/simulation/simulate_drawdown_buying");
const { ExplainStrategySignalUseCase } = require("../../application/strategy/explain_strategy_signal");
const { GetStrategyCandidatesUseCase } = require("../../application/strategy/get_strategy_candidates");
const { ListStrategiesUseCase } = require("../../application/strategy/list_strategies");
const { createBuyExecutionModelResolver } = require("../../simulation/execution/buy_execution_model_resolver");
const { createSecurityExecutionProfileResolver } = require("../../simulation/execution/security_execution_profile_resolver");
const { createAnalyticsGetBollingerTool } = require("./tools/analytics_get_bollinger");
const { createAnalyticsGetDrawdownsTool } = require("./tools/analytics_get_drawdowns");
const { createAnalyticsGetRecoveryPeriodsTool } = require("./tools/analytics_get_recovery_periods");
const { createMarketGetKlineTool } = require("./tools/market_get_kline");
const { createMarketGetSummaryTool } = require("./tools/market_get_summary");
const { createSimulationRunDrawdownBuyingTool } = require("./tools/simulation_run_drawdown_buying");
const { createStrategyExplainSignalTool } = require("./tools/strategy_explain_signal");
const { createStrategyGetCandidatesTool } = require("./tools/strategy_get_candidates");
const { createStrategyListTool } = require("./tools/strategy_list");
const { McpToolRegistry } = require("./tool_registry");

function createMcpCompositionRoot({
  klineReader = null,
  securityMetadataReader = null,
  strategyReader = null,
  signalReader = null,
  signalDatabasePath = null,
  simulationExecutionModelResolver = null,
  simulationSecurityExecutionProfileResolver = null,
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
  simulationUseCase = null,
  simulationTool = null,
  strategyExplainUseCase = null,
  strategyExplainTool = null,
  strategyCandidatesUseCase = null,
  strategyCandidatesTool = null,
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

  let resolvedSecurityMetadataReader = securityMetadataReader;
  const getSecurityMetadataReader = () => {
    if (!resolvedSecurityMetadataReader) {
      resolvedSecurityMetadataReader = new LedgerSecurityMetadataReader();
    }
    return resolvedSecurityMetadataReader;
  };

  let resolvedStrategyReader = strategyReader;
  const getStrategyReader = () => {
    if (!resolvedStrategyReader) resolvedStrategyReader = new BuiltinStrategyReader();
    return resolvedStrategyReader;
  };

  let resolvedSignalReader = signalReader;
  const getSignalReader = () => {
    if (!resolvedSignalReader) {
      resolvedSignalReader = new ReadonlySqliteSignalReader(
        signalDatabasePath ? { databasePath: signalDatabasePath } : {}
      );
    }
    return resolvedSignalReader;
  };

  let resolvedSimulationExecutionModelResolver = simulationExecutionModelResolver;
  const getSimulationExecutionModelResolver = () => {
    if (!resolvedSimulationExecutionModelResolver) {
      resolvedSimulationExecutionModelResolver = createBuyExecutionModelResolver();
    }
    return resolvedSimulationExecutionModelResolver;
  };

  let resolvedSimulationSecurityExecutionProfileResolver = simulationSecurityExecutionProfileResolver;
  const getSimulationSecurityExecutionProfileResolver = () => {
    if (!resolvedSimulationSecurityExecutionProfileResolver) {
      resolvedSimulationSecurityExecutionProfileResolver = createSecurityExecutionProfileResolver();
    }
    return resolvedSimulationSecurityExecutionProfileResolver;
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

  let resolvedSimulationTool = simulationTool;
  if (!resolvedSimulationTool) {
    const resolvedUseCase = simulationUseCase ?? new SimulateDrawdownBuyingUseCase({
      klineReader: getKlineReader(),
      executionModelResolver: getSimulationExecutionModelResolver(),
      securityMetadataReader: getSecurityMetadataReader(),
      securityExecutionProfileResolver: getSimulationSecurityExecutionProfileResolver(),
    });
    resolvedSimulationTool = createSimulationRunDrawdownBuyingTool({ useCase: resolvedUseCase });
  }

  let resolvedStrategyExplainTool = strategyExplainTool;
  if (!resolvedStrategyExplainTool) {
    const resolvedUseCase = strategyExplainUseCase ?? new ExplainStrategySignalUseCase({
      signalReader: getSignalReader(),
    });
    resolvedStrategyExplainTool = createStrategyExplainSignalTool({ useCase: resolvedUseCase });
  }

  let resolvedStrategyCandidatesTool = strategyCandidatesTool;
  if (!resolvedStrategyCandidatesTool) {
    const resolvedUseCase = strategyCandidatesUseCase ?? new GetStrategyCandidatesUseCase({
      signalReader: getSignalReader(),
    });
    resolvedStrategyCandidatesTool = createStrategyGetCandidatesTool({ useCase: resolvedUseCase });
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
  resolvedRegistry.register(resolvedSimulationTool);
  resolvedRegistry.register(resolvedStrategyExplainTool);
  resolvedRegistry.register(resolvedStrategyCandidatesTool);
  resolvedRegistry.register(resolvedStrategyListTool);
  return Object.freeze({ registry: resolvedRegistry });
}

module.exports = {
  createMcpCompositionRoot,
};
