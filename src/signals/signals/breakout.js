"use strict";

const { CapabilityType } = require("../capabilities");

const yearBreakoutSignal = {
  capability: CapabilityType.FIRST_CROSS,
  category: "price",
  defaultScore: 25,
  formatEvidence(context, result) {
    const today = context.features.today;
    const previousTradingDay = context.features.previousTradingDay;
    const previousYear = context.features.previousYear;
    return {
      breakout_margin_pct: result.evidence.margin_pct,
      previous_trading_date: previousTradingDay?.date ?? null,
      previous_trading_day_high: previousTradingDay?.high ?? null,
      previous_year: previousYear?.year ?? null,
      previous_year_high: previousYear?.high ?? null,
      today_date: today?.date ?? null,
      today_high: today?.high ?? null,
    };
  },
  id: "year_breakout",
  params: {
    baseline: "features.previousYear.high",
    current: "features.today.high",
    previous: "features.previousTradingDay.high",
    qualityIssue: false,
  },
};

module.exports = {
  yearBreakoutSignal,
};
