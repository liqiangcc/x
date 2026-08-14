"use strict";

const { calculateDrawdowns } = require("../drawdown/drawdown_calculator");

function recoveryPeriodsFromDrawdowns(events) {
  if (!Array.isArray(events)) throw new TypeError("events must be an array.");
  return events.map((event, index) => {
    if (!event || typeof event !== "object") {
      throw new TypeError(`events[${index}] must be an object.`);
    }
    const declineTradingDays = event.peakToTroughTradingDays;
    const recoveryTradingDays = event.recoveryTradingDays;
    const recovered = event.status === "recovered";
    return {
      peakDate: event.peakDate,
      peakPrice: event.peakPrice,
      troughDate: event.troughDate,
      troughPrice: event.troughPrice,
      drawdown: event.drawdown,
      declineTradingDays,
      recoveryDate: event.recoveryDate,
      recoveryTradingDays,
      underwaterTradingDays: recovered
        ? declineTradingDays + recoveryTradingDays
        : null,
      status: event.status,
    };
  });
}

function calculateRecoveryPeriods(rows, options = {}) {
  return recoveryPeriodsFromDrawdowns(calculateDrawdowns(rows, options));
}

function summarizeRecoveryPeriods(periods) {
  if (!Array.isArray(periods)) throw new TypeError("periods must be an array.");
  const recovered = periods.filter((period) => period?.status === "recovered");
  const recoveryDays = recovered
    .map((period) => period.recoveryTradingDays)
    .filter(Number.isFinite);
  const underwaterDays = recovered
    .map((period) => period.underwaterTradingDays)
    .filter(Number.isFinite);
  const average = (values) => values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length;

  return {
    eventCount: periods.length,
    recoveredCount: recovered.length,
    ongoingCount: periods.filter((period) => period?.status === "ongoing").length,
    averageRecoveryTradingDays: average(recoveryDays),
    maxRecoveryTradingDays: recoveryDays.length === 0 ? null : Math.max(...recoveryDays),
    averageUnderwaterTradingDays: average(underwaterDays),
    maxUnderwaterTradingDays: underwaterDays.length === 0 ? null : Math.max(...underwaterDays),
  };
}

module.exports = {
  calculateRecoveryPeriods,
  recoveryPeriodsFromDrawdowns,
  summarizeRecoveryPeriods,
};
