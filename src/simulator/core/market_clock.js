"use strict";

function normalizeTradingDate(value) {
  const text = String(value ?? "");
  const match = text.match(/^(\d{4})-?(\d{2})-?(\d{2})$/);
  if (!match) throw new TypeError("trading date must use YYYY-MM-DD or YYYYMMDD.");
  return `${match[1]}-${match[2]}-${match[3]}`;
}

class MarketClock {
  constructor({ dates, currentDate }) {
    const normalized = [...new Set((dates ?? []).map(normalizeTradingDate))].sort();
    if (normalized.length === 0) throw new TypeError("MarketClock requires trading dates.");
    this.dates = Object.freeze(normalized);
    this.index = this.dates.indexOf(normalizeTradingDate(currentDate));
    if (this.index < 0) throw new RangeError("currentDate is not a trading date.");
  }

  get currentDate() {
    return this.dates[this.index];
  }

  get nextDate() {
    return this.dates[this.index + 1] ?? null;
  }

  get hasNext() {
    return this.nextDate !== null;
  }

  advance() {
    if (!this.hasNext) {
      const error = new RangeError("No next trading date is available.");
      error.code = "end_of_calendar";
      throw error;
    }
    this.index += 1;
    return this.currentDate;
  }

  snapshot() {
    return { currentDate: this.currentDate, nextDate: this.nextDate };
  }
}

module.exports = {
  MarketClock,
  normalizeTradingDate,
};
