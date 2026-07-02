"use strict";

const { CapabilityType } = require("../capabilities");

const trendConfirmedSignal = {
  capability: CapabilityType.TREND_ALIGNMENT,
  category: "trend",
  defaultScore: 15,
  formatEvidence(context) {
    return {
      ma20: context.features.ma20,
      ma60: context.features.ma60,
      today_close: context.features.today?.close ?? null,
    };
  },
  id: "trend_confirmed",
  params: {
    paths: ["features.today.close", "features.ma20", "features.ma60"],
    qualityIssue: "insufficient_history",
  },
};

module.exports = {
  trendConfirmedSignal,
};
