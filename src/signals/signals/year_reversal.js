"use strict";

const { CapabilityType } = require("../capabilities");

const yearDowntrendReversalSignal = {
  capabilities: [
    {
      capability: CapabilityType.SEQUENCE_PATTERN,
      params: {
        comparator: "lt",
        field: "close",
        order: "latest",
        qualityIssue: "insufficient_yearly_history",
        source: "features.completedYears",
        transitions: 3,
      },
    },
    {
      capability: CapabilityType.VALUE_COMPARE,
      params: {
        left: "features.today.close",
        operator: "gt",
        qualityIssue: "missing_current_year_open",
        right: "features.currentYear.open",
      },
    },
  ],
  category: "trend",
  defaultScore: 20,
  formatEvidence(context, results) {
    const sequence = results[0]?.evidence ?? {};
    const currentYear = context.features.currentYear ?? {};
    return {
      current_year: currentYear.year ?? null,
      current_year_open: currentYear.open ?? null,
      current_year_return_pct: results[1]?.evidence?.margin_pct ?? null,
      downtrend_comparisons: sequence.comparisons ?? [],
      downtrend_points: (sequence.points ?? []).map((point) => ({
        close: point.value,
        date: point.date,
        year: point.year,
      })),
      open_source: currentYear.open_source ?? null,
      required_down_transitions: sequence.transitions ?? null,
      today_close: context.features.today?.close ?? null,
      today_date: context.features.today?.date ?? null,
    };
  },
  id: "year_downtrend_reversal",
};

module.exports = {
  yearDowntrendReversalSignal,
};
