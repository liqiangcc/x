"use strict";

const { DataMode, OrderType, SessionMode } = require("../core/enums");

const DEFAULT_SIMULATOR_CONFIG = Object.freeze({
  version: 1,
  session: Object.freeze({
    mode: SessionMode.MANUAL,
    initialCashYuan: 100000,
  }),
  data: Object.freeze({
    mode: DataMode.LEGACY_APPROXIMATE,
  }),
  selection: Object.freeze({
    strategy: Object.freeze({
      type: "year_decline_close_breakout",
      downTransitions: 3,
      requireConsecutiveCalendarYears: true,
      firstBreakoutScope: "current_year",
      breakoutOperator: "gt",
    }),
    excludeSpecialTreatment: true,
    orderBy: "breakout_margin_ascending",
    limit: 20,
  }),
  execution: Object.freeze({
    orderType: OrderType.NEXT_OPEN,
    slippageRate: 0.001,
    commissionRate: 0.0003,
    minimumCommissionYuan: 5,
    stampDutyRate: 0.0005,
    lotSize: 100,
    tPlusOne: true,
  }),
  risk: Object.freeze({
    enforcement: "warning",
    rules: Object.freeze([]),
  }),
  privacy: Object.freeze({
    anonymousByDefault: true,
    blindModeReveal: "session_end",
  }),
});

module.exports = {
  DEFAULT_SIMULATOR_CONFIG,
};
