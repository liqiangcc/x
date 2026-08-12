"use strict";

const { assertKlineReader } = require("../../ports/market/kline_reader");
const {
  calculateRecoveryPeriods,
  summarizeRecoveryPeriods,
} = require("../../analytics/recovery/recovery_period_calculator");

class AnalyzeRecoveryPeriodsUseCase {
  constructor({
    klineReader,
    calculate = calculateRecoveryPeriods,
    summarize = summarizeRecoveryPeriods,
  } = {}) {
    this.klineReader = assertKlineReader(klineReader);
    if (typeof calculate !== "function") throw new TypeError("calculate must be a function.");
    if (typeof summarize !== "function") throw new TypeError("summarize must be a function.");
    this.calculate = calculate;
    this.summarize = summarize;
  }

  async execute({
    code,
    market,
    startDate = null,
    endDate,
    period = "daily",
    minDrawdown = 0,
    priceField = "close",
  } = {}) {
    const marketData = await this.klineReader.readRange({
      code,
      market,
      startDate,
      endDate,
      period,
      limit: null,
    });
    const periods = this.calculate(marketData.bars, { minDrawdown, priceField });
    return {
      security: marketData.security,
      period: marketData.period,
      startDate: marketData.startDate,
      endDate: marketData.endDate,
      minDrawdown,
      priceField,
      periods,
      summary: this.summarize(periods),
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
  AnalyzeRecoveryPeriodsUseCase,
};
