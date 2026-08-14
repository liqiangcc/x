"use strict";

const { buildDrawdownBuyingPlan } = require("../../business/simulation/drawdown_buying_policy");
const { simulateBuyOrders } = require("../../simulation/portfolio/buy_only_portfolio_simulator");
const { assertKlineReader } = require("../../ports/market/kline_reader");
const {
  assertBuyExecutionModelResolver,
  normalizeBuyExecutionModelId,
} = require("../../ports/simulation/buy_execution_model_resolver");
const {
  assertSecurityExecutionProfileResolver,
} = require("../../ports/simulation/security_execution_profile_resolver");

function positiveMoney(value, field) {
  if (!Number.isFinite(value) || value <= 0) throw new TypeError(`${field} must be positive.`);
  return value;
}

function positiveInteger(value, field) {
  if (!Number.isInteger(value) || value < 1) throw new TypeError(`${field} must be a positive integer.`);
  return value;
}

function optionalExecutionModel(value) {
  if (value === undefined || value === null || value === "") return null;
  return normalizeBuyExecutionModelId(value);
}

function optionalTimelineResolver(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || typeof value.execute !== "function") {
    throw new TypeError("executionProfileTimelineResolver must provide execute().");
  }
  return value;
}

function optionalProviderBuilder(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "function") {
    throw new TypeError("buildExecutionModelProvider must be a function.");
  }
  return value;
}

function projectTimelineSegments(timeline) {
  const segments = Array.isArray(timeline?.segments) ? timeline.segments : [];
  if (segments.length === 0) {
    throw new Error("execution profile timeline must contain at least one segment.");
  }
  return Object.freeze(segments.map((segment) => Object.freeze({
    startDate: segment.startDate,
    endDate: segment.endDate,
    profileId: normalizeBuyExecutionModelId(segment.profileId),
  })));
}

function timelineRange(marketData, bars) {
  return Object.freeze({
    startDate: bars[0]?.date ?? marketData.startDate ?? marketData.endDate,
    endDate: bars.at(-1)?.date ?? marketData.endDate,
  });
}

class SimulateDrawdownBuyingUseCase {
  constructor({
    klineReader,
    executionModelResolver,
    securityExecutionProfileResolver = null,
    executionProfileTimelineResolver = null,
    buildExecutionModelProvider = null,
    buildPlan = buildDrawdownBuyingPlan,
    simulatePortfolio = simulateBuyOrders,
  } = {}) {
    this.klineReader = assertKlineReader(klineReader);
    this.executionModelResolver = assertBuyExecutionModelResolver(executionModelResolver);
    this.securityExecutionProfileResolver = securityExecutionProfileResolver === null
      ? null
      : assertSecurityExecutionProfileResolver(securityExecutionProfileResolver);
    this.executionProfileTimelineResolver = optionalTimelineResolver(
      executionProfileTimelineResolver
    );
    this.buildExecutionModelProvider = optionalProviderBuilder(buildExecutionModelProvider);
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
    executionModel = null,
    securityMetadata = null,
  } = {}) {
    const normalizedInitialCapital = positiveMoney(Number(initialCapital), "initialCapital");
    const normalizedLotSize = positiveInteger(lotSize, "lotSize");
    const executionModelOverride = optionalExecutionModel(executionModel);
    const marketData = await this.klineReader.readRange({
      code,
      market,
      startDate,
      endDate,
      period,
      limit: null,
    });
    const bars = Array.isArray(marketData.bars) ? marketData.bars : [];

    let executionModelSelection = "explicit_override";
    let securityMetadataSource = null;
    let normalizedExecutionModel = executionModelOverride;
    let executionModelProvider = null;
    let executionTimeline = null;

    if (normalizedExecutionModel === null) {
      if (securityMetadata !== null && securityMetadata !== undefined) {
        executionModelSelection = "security_metadata";
        securityMetadataSource = "request";
        if (!this.securityExecutionProfileResolver) {
          throw new TypeError("securityExecutionProfileResolver is required when securityMetadata is supplied.");
        }
        normalizedExecutionModel = normalizeBuyExecutionModelId(
          this.securityExecutionProfileResolver.resolve({
            security: marketData.security,
            metadata: securityMetadata,
          })
        );
      } else {
        executionModelSelection = "security_metadata_timeline";
        securityMetadataSource = "timeline";
        if (!this.executionProfileTimelineResolver) {
          throw new TypeError(
            "executionProfileTimelineResolver is required for automatic execution-profile selection."
          );
        }
        if (!this.buildExecutionModelProvider) {
          throw new TypeError(
            "buildExecutionModelProvider is required for automatic execution-profile selection."
          );
        }
        const range = timelineRange(marketData, bars);
        const resolvedTimeline = await this.executionProfileTimelineResolver.execute({
          security: marketData.security,
          startDate: range.startDate,
          endDate: range.endDate,
        });
        executionTimeline = projectTimelineSegments(resolvedTimeline);
        const profileIds = [...new Set(executionTimeline.map((segment) => segment.profileId))];
        normalizedExecutionModel = profileIds.length === 1 ? profileIds[0] : null;
        executionModelProvider = this.buildExecutionModelProvider({
          segments: executionTimeline,
          executionConfig: { lotSize: normalizedLotSize },
        });
      }
    }

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

    const portfolioInput = {
      bars,
      orders,
      security: marketData.security,
      initialCash: normalizedInitialCapital,
      priceField,
    };
    if (executionModelProvider) {
      portfolioInput.executionModelProvider = executionModelProvider;
    } else {
      portfolioInput.executionModel = this.executionModelResolver.resolve({
        model: normalizedExecutionModel,
        executionConfig: { lotSize: normalizedLotSize },
      });
    }
    const portfolio = this.simulatePortfolio(portfolioInput);

    const executionSelection = {
      mode: executionModelSelection,
      profileId: normalizedExecutionModel,
      securityMetadataSource,
    };
    if (executionTimeline) executionSelection.timeline = executionTimeline;

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
        executionModelSelection,
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
        executionSelection,
        execution: portfolio.config,
      },
    };
  }
}

module.exports = {
  SimulateDrawdownBuyingUseCase,
  optionalExecutionModel,
  optionalProviderBuilder,
  optionalTimelineResolver,
  positiveInteger,
  positiveMoney,
  projectTimelineSegments,
  timelineRange,
};
