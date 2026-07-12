"use strict";

const { normalizeSecurityId } = require("../core/contracts");

function toIsoDate(value, field = "date") {
  const digits = String(value ?? "").replaceAll("-", "");
  if (!/^\d{8}$/.test(digits)) {
    throw new TypeError(`${field} must use YYYYMMDD or YYYY-MM-DD.`);
  }
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

class LegacyTradingCalendar {
  constructor({ dates, sourceSecurities = 0, qualityIssues = ["trading_calendar_approximation"] }) {
    const normalized = [...new Set(Array.from(dates ?? [], (date) => toIsoDate(date)))].sort();
    this.dates = Object.freeze(normalized);
    this.sourceSecurities = sourceSecurities;
    this.qualityIssues = Object.freeze([...new Set(qualityIssues)].sort());
    this.indexByDate = new Map(this.dates.map((date, index) => [date, index]));
  }

  has(date) {
    return this.indexByDate.has(toIsoDate(date));
  }

  next(date) {
    const target = toIsoDate(date);
    const index = this.indexByDate.get(target);
    if (index !== undefined) return this.dates[index + 1] ?? null;
    return this.dates.find((item) => item > target) ?? null;
  }

  previous(date) {
    const target = toIsoDate(date);
    const index = this.indexByDate.get(target);
    if (index !== undefined) return this.dates[index - 1] ?? null;
    return this.dates.findLast((item) => item < target) ?? null;
  }

  between(startDate, endDate) {
    const start = toIsoDate(startDate, "startDate");
    const end = toIsoDate(endDate, "endDate");
    if (end < start) throw new RangeError("endDate must not be earlier than startDate.");
    return this.dates.filter((date) => date >= start && date <= end);
  }

  static async fromRepository({ marketDataRepository, securities, startDate = null, endDate }) {
    if (!marketDataRepository || typeof marketDataRepository.getLegacyHistory !== "function") {
      throw new TypeError("marketDataRepository.getLegacyHistory is required.");
    }
    const end = toIsoDate(endDate, "endDate");
    const start = startDate === null ? null : toIsoDate(startDate, "startDate");
    const normalizedSecurities = (securities ?? []).map(normalizeSecurityId);
    const dates = new Set();
    for (const security of normalizedSecurities) {
      const history = await marketDataRepository.getLegacyHistory({
        ...security,
        endDate: end,
        period: "daily",
      });
      for (const bar of history.bars ?? []) {
        if (start === null || bar.date >= start) dates.add(bar.date);
      }
    }
    return new LegacyTradingCalendar({
      dates,
      sourceSecurities: normalizedSecurities.length,
      qualityIssues: ["trading_calendar_approximation"],
    });
  }
}

module.exports = {
  LegacyTradingCalendar,
  toIsoDate,
};
