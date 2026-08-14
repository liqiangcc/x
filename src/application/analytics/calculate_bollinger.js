"use strict";

const { assertKlineReader } = require("../../ports/market/kline_reader");
const {
  STDDEV_MODES,
  calculateBollSeries,
} = require("../../signals/indicators/boll");

const PRICE_FIELDS = new Set(["open", "close", "high", "low"]);
const MAX_OUTPUT_POINTS = 200;

function normalizeWindow(value) {
  const normalized = value ?? 20;
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > 250) {
    throw new TypeError("window must be an integer between 1 and 250.");
  }
  return normalized;
}

function normalizeMultiplier(value) {
  const normalized = value ?? 2;
  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new TypeError("multiplier must be a non-negative finite number.");
  }
  return normalized;
}

function normalizeStddevMode(value) {
  const normalized = String(value ?? "population").trim();
  if (!STDDEV_MODES.has(normalized)) {
    throw new TypeError("stddevMode must be population or sample.");
  }
  return normalized;
}

function normalizePriceField(value) {
  const normalized = String(value ?? "close").trim();
  if (!PRICE_FIELDS.has(normalized)) {
    throw new TypeError("priceField must be open, close, high, or low.");
  }
  return normalized;
}

function normalizeOutputPoints(value) {
  const normalized = value ?? 20;
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > MAX_OUTPUT_POINTS) {
    throw new TypeError(`points must be an integer between 1 and ${MAX_OUTPUT_POINTS}.`);
  }
  return normalized;
}

class CalculateBollingerUseCase {
  constructor({ klineReader, calculate = calculateBollSeries } = {}) {
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
    window = 20,
    multiplier = 2,
    stddevMode = "population",
    priceField = "close",
    points = 20,
  } = {}) {
    const normalizedWindow = normalizeWindow(window);
    const normalizedMultiplier = normalizeMultiplier(multiplier);
    const normalizedStddevMode = normalizeStddevMode(stddevMode);
    const normalizedPriceField = normalizePriceField(priceField);
    const normalizedPoints = normalizeOutputPoints(points);
    if (normalizedStddevMode === "sample" && normalizedWindow < 2) {
      throw new TypeError("sample stddevMode requires window to be at least 2.");
    }

    const readLimit = startDate == null
      ? normalizedWindow + normalizedPoints - 1
      : null;
    const marketData = await this.klineReader.readRange({
      code,
      market,
      startDate,
      endDate,
      period,
      limit: readLimit,
    });
    const bars = Array.isArray(marketData.bars) ? marketData.bars : [];
    const series = this.calculate(bars, {
      field: normalizedPriceField,
      period: normalizedWindow,
      multiplier: normalizedMultiplier,
      stddevMode: normalizedStddevMode,
    });
    const projected = series.map((boll, index) => ({
      date: boll.date,
      price: Number.isFinite(bars[index]?.[normalizedPriceField])
        ? bars[index][normalizedPriceField]
        : null,
      lower: boll.lower,
      middle: boll.middle,
      stddev: boll.stddev,
      upper: boll.upper,
    }));
    const returned = projected.slice(-normalizedPoints);
    const latest = [...returned].reverse().find((point) => Number.isFinite(point.middle)) ?? null;

    return {
      security: marketData.security,
      period: marketData.period,
      startDate: marketData.startDate,
      endDate: marketData.endDate,
      window: normalizedWindow,
      multiplier: normalizedMultiplier,
      stddevMode: normalizedStddevMode,
      priceField: normalizedPriceField,
      points: returned,
      latest,
      coverage: {
        inputBars: bars.length,
        returnedPoints: returned.length,
        validPoints: returned.filter((point) => Number.isFinite(point.middle)).length,
        warmupComplete: bars.length >= normalizedWindow,
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
  CalculateBollingerUseCase,
  MAX_OUTPUT_POINTS,
  PRICE_FIELDS,
  normalizeMultiplier,
  normalizeOutputPoints,
  normalizePriceField,
  normalizeStddevMode,
  normalizeWindow,
};
