"use strict";

function defaultRanking(orderBy = "price_ascending") {
  return orderBy === "breakout_margin_ascending"
    ? [{ direction: "asc", nulls: "last", operand: { key: "first_breakout", kind: "ruleOutput", output: "relativeDifferencePct" } }]
    : [{ direction: "asc", nulls: "last", operand: { id: "daily.today.close", kind: "feature" } }];
}

function toV3Definition(input = {}, { orderBy } = {}) {
  if (input.schemaVersion === 3 && input.type === "composite") return structuredClone(input);
  if (input.type !== "capability_composite") {
    const transitions = input.downTransitions ?? 3;
    input = {
      indicators: [],
      rules: [
        { key: "three_year_decline", params: { comparator: "lt", field: "close", transitions }, type: "sequence_compare" },
        { key: "first_breakout", params: { baseline: "yearly.previous.high", comparator: "gt", current: "daily.today.close", historyField: "close" }, type: "first_occurrence" },
      ],
      schemaVersion: 2,
      type: "capability_composite",
    };
  }
  const rules = (input.rules ?? []).map((rule) => {
    const params = { ...(rule.params ?? {}) };
    delete params.continuity;
    delete params.historySource;
    delete params.selection;
    delete params.source;
    return { key: rule.key, params, type: rule.type };
  });
  return {
    composition: { operator: "all", ruleKeys: rules.map((rule) => rule.key) },
    emission: { mode: "on_match" },
    indicators: structuredClone(input.indicators ?? []),
    ranking: defaultRanking(orderBy),
    rules,
    schemaVersion: 3,
    type: "composite",
  };
}

module.exports = { defaultRanking, toV3Definition };
