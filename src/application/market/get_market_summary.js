"use strict";

const { calculateMarketSummary } = require("../../analytics/market/market_summary_calculator");
const { assertKlineReader } = require("../../ports/market/kline_reader");
const {
  LEDGER_DEFAULT_ADJUSTMENT,
  normalizeAdjustment,
} = require("./get_kline_range");

class GetMarketSummaryUseCase {
  constructor({ klineReader, calculate = calculateMarketSummary } = {}) {
    this.klineReader = assertKlineReader(klineReader);
    if (typeof calculate !== "function") throw new TypeError("calculate must be a function.");
    this.calculate = calculate;
  }

  async execute({
    code,
    market,
    startDate = null,
    endDate,
    period = "daily",
    adjustment = LEDGER_DEFAULT_ADJUSTMENT,
  } = {}) {
    const normalizedAdjustment = normalizeAdjustment(adjustment);
    const marketData = await this.klineReader.readRange({
      code,
      market,
      startDate,
      endDate,
      period,
      limit: null,
    });
    const summary = this.calculate(Array.isArray(marketData.bars) ? marketData.bars : []);

    return {
      security: marketData.security,
      period: marketData.period,
      startDate: marketData.startDate,
      endDate: marketData.endDate,
      adjustment: normalizedAdjustment,
      latest: summary.latest,
      range: summary.range,
      coverage: {
        requestedStartDate: marketData.startDate,
        requestedEndDate: marketData.endDate,
        observedStartDate: summary.coverage.observedStartDate,
        observedEndDate: summary.coverage.observedEndDate,
        barCount: summary.coverage.barCount,
      },
      meta: {
        dataMode: marketData.dataMode,
        priceView: marketData.priceView,
        qualityIssues: marketData.qualityIssues,
        source: marketData.source,
      },
    };
  }
}

module.exports = {
  GetMarketSummaryUseCase,
};
