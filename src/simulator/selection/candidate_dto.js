"use strict";

const EVIDENCE_FIELDS = [
  "annual_points",
  "breakout_margin",
  "breakout_margin_pct",
  "down_transitions",
  "max_previous_current_year_close",
  "previous_year_high",
  "required_complete_years",
  "rules",
  "rule_summary",
  "today_close",
  "today_change_pct",
  "today_date",
];

function pick(source, fields) {
  return Object.fromEntries(fields.filter((field) => source?.[field] !== undefined).map((field) => [field, source[field]]));
}

function evidenceDto(evidence) {
  const dto = pick(evidence, EVIDENCE_FIELDS);
  if (Array.isArray(dto.annual_points)) {
    dto.annual_points = dto.annual_points.map((point) => pick(point, ["close", "high", "year"]));
  }
  if (Array.isArray(dto.rules)) {
    dto.rules = dto.rules.map((rule) => pick(rule, [
      "actual", "baseline", "category", "comparisons", "count", "current", "direction", "expected", "feature", "historyCount", "key", "left", "limitState", "lookback",
      "ok", "operator", "previousExtreme", "previousLeft", "previousRight", "priorMatchCount",
      "qualityIssues", "requiredPoints", "right", "threshold", "minimum", "type",
    ]));
  }
  return dto;
}

function candidateDto(candidate, identity) {
  return {
    alias: identity.alias,
    candidateId: identity.candidateId,
    evidence: evidenceDto(candidate.evidence),
    qualityIssues: [...(candidate.qualityIssues ?? [])],
    rank: candidate.rank ?? null,
    security: identity.security ?? null,
  };
}

function barDto(bar) {
  return pick(bar, [
    "date", "open", "close", "high", "low", "volume", "amount",
    "bollLower", "bollMiddle", "bollUpper", "breakout", "previousYearHigh", "signal",
  ]);
}

function chartDto({ candidateId, alias, daily = [], detail = null, security = null, yearly = [] }) {
  return {
    alias,
    candidateId,
    daily: daily.map(barDto),
    detail,
    security,
    yearly: yearly.map((bar) => pick(bar, ["year", "open", "close", "high", "low", "volume", "amount"])),
  };
}

function holdingDto(holding, identity) {
  return {
    alias: identity.alias,
    availableQuantity: holding.availableQuantity,
    averageCost: holding.averageCost,
    candidateId: identity.candidateId,
    currentPrice: holding.currentPrice,
    holdingDays: holding.holdingDays,
    marketValue: holding.marketValue,
    priceDayOffset: holding.priceDayOffset,
    quantity: holding.quantity,
    security: identity.security ?? null,
    unrealizedPnl: holding.unrealizedPnl,
    unrealizedPnlPct: holding.unrealizedPnlPct,
  };
}

module.exports = {
  EVIDENCE_FIELDS,
  barDto,
  candidateDto,
  chartDto,
  evidenceDto,
  holdingDto,
  pick,
};
