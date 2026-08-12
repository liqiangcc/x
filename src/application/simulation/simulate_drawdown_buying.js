"use strict";

const { buildDrawdownBuyingPlan } = require("../../business/simulation/drawdown_buying_policy");
const { simulateBuyOrders } = require("../../simulation/portfolio/buy_only_portfolio_simulator");
const { assertKlineReader } = require("../../ports/market/kline_reader");
const {
  DEFAULT_BUY_EXECUTION_MODEL_ID,
  assertBuyExecutionModelResolver,
  normalizeBuyExecutionModelId,
} = require("../../ports/simulation/buy_execution_model_resolver");

function positiveMoney(value, field) {
  if (!Number.isFinite(value) || value <= 0) throw new TypeError(`${field} must be positive.`);
  return value;
}

function positiveInteger(value, field) {
  if (!Number.isInteger(value) || value < 1) throw new TypeError(`${field} must be a positive integer.`);
  return value;
}

class SimulateDrawdownBuyingUseCase {
  constructor({
    klineReader,
    executionModelResolver,
    buildPlan = buildDrawdownBuyingPlan,
    simulatePortfolio = simulateBuyOrders,
  } = {}) {
    this.klineReader = assertKlineReader(klineReader);
    this.executionModelResolver = assertBuyExecutionModelResolver(executionModelResolver);
    if (typeof buildPlan !== "function") throw new TypeError("buildPlan must be a function.");
    if (typeof simulatePortfolio !== "function") throw new TypeError("simulatePortfolio must be a function.");
    this.buildPlan = buildPlan;
    this.simulatePortfolio = simulatePortfolio;
  }

  async execute({
    code,
    market,
    startDate = null,
    endDate,
    period = "daily",
    initialCapital = 100000,
    initialDrawdown = 0,
    drawdownStep = 0.08,
    trancheFraction = 0.1,
    maxPurchases = 10,
    lotSize = 100,
    priceField = "close",
    executionModel = DEFAULT_BUY_EXECUTION_MODEL_ID,
  } = {}) {
    const normalizedInitialCapital = positiveMoney(Number(initialCapital), "initialCapital");
    const normalizedLotSize = positiveInteger(lotSize, "lotSize");
    const normalizedExecutionModel = normalizeBuyExecutionModelId(executionModel);
    const marketData = await this.klineReader.readRange({
      code,
      market,
      startDate,
      endDate,
      period,
      limit: null,
    });
    const bars = Array.isArray(marketData.bars) ? marketData.bars : [];
    const plan = this.buildPlan(bars, {
      initialDrawdown,
      drawdownStep,
      trancheFraction,
      maxPurchases,
      priceField,
    });
    const orders = plan.signals.map((signal) => ({
      date: signal.date,
      budget: normalizedInitialCapital * signal.allocationFraction,
      metadata: {
        signalIndex: signal.index,
        signalType: signal.type,
        referenceDate: signal.referenceDate,
        referencePrice: signal.referencePrice,
        triggerPrice: signal.triggerPrice,
        drawdownFromReference: signal.drawdownFromReference,
      },
    }));
    const resolvedExecutionModel = this.executionModelResolver.resolve({
      model: normalizedExecutionModel,
      executionConfig: { lotSize: normalizedLotSize },
    });
    const portfolio = this.simulatePortfolio({
      bars,
      orders,
      security: marketData.security,
      initialCash: normalizedInitialCapital,
      priceField,
      executionModel: resolvedExecutionModel,
    });

    return {
      security: marketData.security,
      period: marketData.period,
      startDate: marketData.startDate,
      endDate: marketData.endDate,
      config: {
        ...plan.config,
        initialCapital: normalizedInitialCapital,
        lotSize: normalizedLotSize,
        executionModel: normalizedExecutionModel,
      },
      signals: plan.signals,
      trades: portfolio.trades,
      summary: {
        policy: plan.summary,
        portfolio: portfolio.summary,
      },
      meta: {
        dataMode: marketData.dataMode,
        priceView: marketData.priceView,
        qualityIssues: marketData.qualityIssues,
        source: marketData.source,
        execution: portfolio.config,
      },
    };
  }
}

module.exports = {
  SimulateDrawdownBuyingUseCase,
  positiveInteger,
  positiveMoney,
};
