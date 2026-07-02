"use strict";

const { CapabilityType } = require("../capabilities");

const volumeExpandSignal = {
  capability: CapabilityType.RATIO_COMPARE,
  category: "volume",
  defaultScore: 20,
  formatEvidence(context, result) {
    return {
      average_amount_20: result.evidence.baseline_value,
      ratio: result.evidence.ratio,
      threshold_amount: result.evidence.threshold_value,
      today_amount: result.evidence.current_value,
      volume_margin_pct: result.evidence.margin_pct,
    };
  },
  id: "volume_expand",
  params: {
    baseline: "features.averageAmount20",
    current: "features.today.amount",
    qualityIssue: "insufficient_history",
    ratio: 1.5,
  },
};

module.exports = {
  volumeExpandSignal,
};
