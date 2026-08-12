"use strict";

const { assertKlineReader } = require("../../ports/market/kline_reader");
const {
  calculateDrawdowns,
  summarizeDrawdowns,
} = require("../../analytics/drawdown/drawdown_calculator");

class AnalyzeDrawdownsUseCase {
  constructor({
    klineReader,
    calculate = calculateDrawdowns,
    summarize = summarizeDrawdowns,
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
    const events = this.calculate(marketData.bars, { minDrawdown, priceField });
    return {
      security: marketData.security,
      period: marketData.period,
      startDate: marketData.startDate,
      endDate: marketData.endDate,
      minDrawdown,
      priceField,
      events,
      summary: this.summarize(events),
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
  AnalyzeDrawdownsUseCase,
};
