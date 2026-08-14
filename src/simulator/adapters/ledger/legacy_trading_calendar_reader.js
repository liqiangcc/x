"use strict";

const { LegacyTradingCalendar } = require("../../data/legacy_trading_calendar");

function createLegacyTradingCalendarReader({
  marketDataRepository,
  securities = [{ code: "000001", market: 0 }],
} = {}) {
  if (!marketDataRepository || typeof marketDataRepository.getLegacyHistory !== "function") {
    throw new TypeError("marketDataRepository.getLegacyHistory is required.");
  }

  return {
    readCalendar({ startDate, endDate }) {
      return LegacyTradingCalendar.fromRepository({
        endDate,
        marketDataRepository,
        securities,
        startDate,
      });
    },
  };
}

module.exports = {
  createLegacyTradingCalendarReader,
};
