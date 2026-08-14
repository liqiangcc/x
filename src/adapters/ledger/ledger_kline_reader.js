"use strict";

const {
  ExistingKlineRepository,
  isoDate,
} = require("../../simulator/adapters/ledger/existing_kline_repository");

function normalizeOptionalDate(value, field) {
  if (value === undefined || value === null || value === "") return null;
  return isoDate(value, field);
}

function normalizeLimit(value) {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError("limit must be a positive integer or null.");
  }
  return value;
}

class LedgerKlineReader {
  constructor({ repository = new ExistingKlineRepository() } = {}) {
    if (!repository || typeof repository.getLegacyHistory !== "function") {
      throw new TypeError("repository must provide getLegacyHistory().");
    }
    this.repository = repository;
  }

  async readRange({
    code,
    market,
    startDate = null,
    endDate,
    period = "daily",
    limit = null,
  } = {}) {
    const normalizedStart = normalizeOptionalDate(startDate, "startDate");
    const normalizedEnd = isoDate(endDate, "endDate");
    const normalizedLimit = normalizeLimit(limit);
    if (normalizedStart && normalizedStart > normalizedEnd) {
      throw new TypeError("startDate must not be after endDate.");
    }

    const history = await this.repository.getLegacyHistory({
      code,
      market,
      endDate: normalizedEnd,
      period,
      limit: null,
    });

    let bars = Array.isArray(history.bars) ? history.bars : [];
    if (normalizedStart) bars = bars.filter((bar) => bar.date >= normalizedStart);
    if (normalizedLimit !== null) bars = bars.slice(-normalizedLimit);

    return {
      security: history.security ?? { code: String(code), market: Number(market) },
      period: history.period ?? period,
      startDate: normalizedStart,
      endDate: normalizedEnd,
      bars,
      dataMode: history.dataMode ?? null,
      priceView: history.priceView ?? null,
      qualityIssues: [...new Set(history.qualityIssues ?? [])].sort(),
      source: {
        kind: "repo_ledger",
        contentHash: history.contentHash ?? null,
        path: history.sourcePath ?? null,
      },
    };
  }
}

module.exports = {
  LedgerKlineReader,
  normalizeLimit,
  normalizeOptionalDate,
};
