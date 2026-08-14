"use strict";

const { assertKlineReader } = require("../../ports/market/kline_reader");

const DEFAULT_KLINE_LIMIT = 200;
const MAX_KLINE_LIMIT = 500;
const LEDGER_DEFAULT_ADJUSTMENT = "ledger_default";

function normalizeKlineLimit(value, { max = MAX_KLINE_LIMIT } = {}) {
  if (!Number.isInteger(max) || max < 1) {
    throw new TypeError("max must be a positive integer.");
  }
  const resolved = value === undefined || value === null ? DEFAULT_KLINE_LIMIT : value;
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > max) {
    throw new TypeError(`limit must be an integer between 1 and ${max}.`);
  }
  return resolved;
}

function normalizeAdjustment(value = LEDGER_DEFAULT_ADJUSTMENT) {
  if (value !== LEDGER_DEFAULT_ADJUSTMENT) {
    throw new TypeError(`adjustment must be ${LEDGER_DEFAULT_ADJUSTMENT}.`);
  }
  return value;
}

function previousIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""))) {
    throw new TypeError("date must use YYYY-MM-DD.");
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function toKlineBar(bar) {
  return {
    date: bar?.date ?? null,
    open: Number.isFinite(bar?.open) ? bar.open : null,
    close: Number.isFinite(bar?.close) ? bar.close : null,
    high: Number.isFinite(bar?.high) ? bar.high : null,
    low: Number.isFinite(bar?.low) ? bar.low : null,
    volume: Number.isFinite(bar?.volume) ? bar.volume : null,
    amount: Number.isFinite(bar?.amount) ? bar.amount : null,
    changePct: Number.isFinite(bar?.changePct) ? bar.changePct : null,
  };
}

class GetKlineRangeUseCase {
  constructor({ klineReader, maxBars = MAX_KLINE_LIMIT } = {}) {
    this.klineReader = assertKlineReader(klineReader);
    if (!Number.isInteger(maxBars) || maxBars < 1) {
      throw new TypeError("maxBars must be a positive integer.");
    }
    this.maxBars = maxBars;
  }

  async execute({
    code,
    market,
    startDate = null,
    endDate,
    period = "daily",
    limit = DEFAULT_KLINE_LIMIT,
    adjustment = LEDGER_DEFAULT_ADJUSTMENT,
  } = {}) {
    const requestedLimit = normalizeKlineLimit(limit, { max: this.maxBars });
    const normalizedAdjustment = normalizeAdjustment(adjustment);
    const marketData = await this.klineReader.readRange({
      code,
      market,
      startDate,
      endDate,
      period,
      limit: requestedLimit + 1,
    });

    const sourceBars = Array.isArray(marketData.bars) ? marketData.bars : [];
    const hasMore = sourceBars.length > requestedLimit;
    const selectedBars = hasMore ? sourceBars.slice(-requestedLimit) : sourceBars;
    const bars = selectedBars.map(toKlineBar);
    const firstDate = bars[0]?.date ?? null;

    return {
      security: marketData.security,
      period: marketData.period,
      startDate: marketData.startDate,
      endDate: marketData.endDate,
      adjustment: normalizedAdjustment,
      bars,
      page: {
        limit: requestedLimit,
        returnedBars: bars.length,
        hasMore,
        nextEndDate: hasMore && firstDate ? previousIsoDate(firstDate) : null,
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
  DEFAULT_KLINE_LIMIT,
  GetKlineRangeUseCase,
  LEDGER_DEFAULT_ADJUSTMENT,
  MAX_KLINE_LIMIT,
  normalizeAdjustment,
  normalizeKlineLimit,
  previousIsoDate,
  toKlineBar,
};
