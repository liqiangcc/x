"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { normalizeKlineRows } = require("../../../signals/features");
const { normalizeSecurityId } = require("../../core/contracts");
const { DataMode, PriceView } = require("../../core/enums");

const PERIODS = new Set(["daily", "yearly"]);

function isoDate(value, field = "date") {
  const digits = String(value ?? "").replaceAll("-", "");
  if (!/^\d{8}$/.test(digits)) {
    throw new TypeError(`${field} must use YYYYMMDD or YYYY-MM-DD.`);
  }
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function klinePaths(root, period, code) {
  return [
    path.join(root, period, code.slice(0, 3), `${code}.json`),
    path.join(root, period, `${code}.json`),
  ];
}

function extractRows(payload) {
  if (Array.isArray(payload?.klines)) return payload.klines;
  if (Array.isArray(payload?.data?.klines)) return payload.data.klines;
  return [];
}

function executionIssues(bar) {
  if (!bar) return ["missing_execution_bar"];
  if (![bar.open, bar.high, bar.low, bar.close].every((value) => Number.isFinite(value) && value > 0)) {
    return ["invalid_execution_price"];
  }
  return [];
}

class ExistingKlineRepository {
  constructor({ cacheSize = 256, klineRoot = path.join("data", "kline") } = {}) {
    if (!Number.isInteger(cacheSize) || cacheSize < 1) throw new TypeError("cacheSize must be a positive integer.");
    this.cache = new Map();
    this.cacheSize = cacheSize;
    this.inFlight = new Map();
    this.klineRoot = klineRoot;
  }

  async loadFirst(paths) {
    for (const filePath of paths) {
      let stat;
      try {
        stat = await fs.stat(filePath);
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      const signature = `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
      const cached = this.cache.get(filePath);
      if (cached?.signature === signature) {
        this.cache.delete(filePath);
        this.cache.set(filePath, cached);
        return cached.value;
      }
      const inFlightKey = `${filePath}:${signature}`;
      let loading = this.inFlight.get(inFlightKey);
      if (!loading) {
        loading = this.loadFile(filePath, signature);
        this.inFlight.set(inFlightKey, loading);
      }
      try {
        return await loading;
      } finally {
        if (this.inFlight.get(inFlightKey) === loading) this.inFlight.delete(inFlightKey);
      }
    }
    return null;
  }

  async loadFile(filePath, signature) {
    const source = await fs.readFile(filePath, "utf8");
    let payload;
    try {
      payload = JSON.parse(source);
    } catch (error) {
      const wrapped = new Error(`Unable to parse kline file: ${filePath}`);
      wrapped.code = "invalid_kline_file";
      wrapped.cause = error;
      throw wrapped;
    }
    const normalized = normalizeKlineRows(extractRows(payload));
    const value = {
      filePath,
      hash: crypto.createHash("sha256").update(source).digest("hex"),
      issues: [...new Set(normalized.issues)].sort(),
      rows: normalized.rows,
    };
    this.cache.delete(filePath);
    this.cache.set(filePath, { signature, value });
    while (this.cache.size > this.cacheSize) this.cache.delete(this.cache.keys().next().value);
    return value;
  }

  async getLegacyHistory({ code, market, endDate, limit = null, period = "daily" }) {
    const security = normalizeSecurityId({ code, market });
    const cutoff = isoDate(endDate, "endDate");
    if (!PERIODS.has(period)) {
      throw new TypeError(`Unsupported kline period: ${period}`);
    }
    if (limit !== null && (!Number.isInteger(limit) || limit < 1)) {
      throw new TypeError("limit must be a positive integer or null.");
    }

    const loaded = await this.loadFirst(klinePaths(this.klineRoot, period, security.code));
    if (!loaded) {
      return {
        dataMode: DataMode.LEGACY_APPROXIMATE,
        priceView: PriceView.LEGACY_FORWARD_ADJUSTED,
        security,
        period,
        endDate: cutoff,
        bars: [],
        contentHash: null,
        sourcePath: null,
        qualityIssues: [`missing_${period}_kline`],
      };
    }

    const truncated = loaded.rows.filter((bar) => bar.date <= cutoff);
    const bars = limit === null ? truncated : truncated.slice(-limit);
    return {
      dataMode: DataMode.LEGACY_APPROXIMATE,
      priceView: PriceView.LEGACY_FORWARD_ADJUSTED,
      security,
      period,
      endDate: cutoff,
      bars,
      contentHash: loaded.hash,
      sourcePath: loaded.filePath,
      qualityIssues: loaded.issues,
    };
  }

  async getLegacyBar({ code, market, date }) {
    const targetDate = isoDate(date);
    const history = await this.getLegacyHistory({
      code,
      market,
      endDate: targetDate,
      period: "daily",
    });
    const bar = history.bars.find((item) => item.date === targetDate) ?? null;
    const qualityIssues = [...new Set([...history.qualityIssues, ...executionIssues(bar)])].sort();
    return {
      ...history,
      date: targetDate,
      bar,
      executionEligible: qualityIssues.length === 0,
      qualityIssues,
    };
  }
}

module.exports = {
  ExistingKlineRepository,
  executionIssues,
  extractRows,
  isoDate,
  klinePaths,
};
