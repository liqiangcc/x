"use strict";

const { marketBoardForCode } = require("../core/market_board");

const LIMIT_FEATURES = Object.freeze([
  "daily.today.broken_limit_up",
  "daily.today.is_limit_up",
  "daily.today.is_one_price_limit_up",
  "daily.today.opened_limit_up",
  "daily.today.touched_limit_up",
]);

const LIMIT_FEATURE_PROPERTIES = Object.freeze({
  "daily.today.broken_limit_up": "brokenLimitUp",
  "daily.today.is_limit_up": "isLimitUp",
  "daily.today.is_one_price_limit_up": "isOnePriceLimitUp",
  "daily.today.opened_limit_up": "openedLimitUp",
  "daily.today.touched_limit_up": "touchedLimitUp",
});

function normalLimitRate({ date, security }) {
  const board = marketBoardForCode(security);
  if (board === "beijingExchange") return { board, ratePct: 30, ruleVersion: "beijing_30_v1" };
  if (board === "starMarket") return { board, ratePct: 20, ruleVersion: "star_20_v1" };
  if (board === "chiNext") {
    return String(date) >= "2020-08-24"
      ? { board, ratePct: 20, ruleVersion: "chinext_20_since_20200824_v1" }
      : { board, ratePct: 10, ruleVersion: "chinext_10_before_20200824_v1" };
  }
  return { board, ratePct: 10, ruleVersion: "main_10_v1" };
}

function roundPrice(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function atOrAbove(value, target) {
  return Number.isFinite(value) && Number.isFinite(target) && value >= target - 0.005;
}

function deriveLimitState({ bar, previousBar, security }) {
  const policy = normalLimitRate({ date: bar?.date, security });
  const issues = ["legacy_approximate_limit_rules"];
  const previousClose = previousBar?.close;
  const limitUpPrice = Number.isFinite(previousClose) && previousClose > 0
    ? roundPrice(previousClose * (1 + policy.ratePct / 100))
    : null;
  const reportedChangePct = Number.isFinite(bar?.changePct) ? bar.changePct : null;
  if (!Number.isFinite(limitUpPrice)) issues.push("missing_previous_close_for_limit_rule");
  if (!Number.isFinite(reportedChangePct)) issues.push("missing_reported_change_pct");

  const closeByReportedRate = Number.isFinite(reportedChangePct)
    && reportedChangePct >= policy.ratePct - 0.15;
  const closeByPrice = atOrAbove(bar?.close, limitUpPrice);
  const isLimitUp = closeByReportedRate || closeByPrice;
  const touchedLimitUp = atOrAbove(bar?.high, limitUpPrice) || isLimitUp;
  const openedLimitUp = atOrAbove(bar?.open, limitUpPrice);
  const samePrice = [bar?.open, bar?.high, bar?.low, bar?.close].every((value) =>
    Number.isFinite(value) && Number.isFinite(limitUpPrice) && Math.abs(value - limitUpPrice) < 0.005
  );

  return {
    board: policy.board,
    brokenLimitUp: touchedLimitUp && !isLimitUp,
    calculationSource: closeByReportedRate ? "reported_change_pct" : "previous_close_price",
    isLimitUp,
    isOnePriceLimitUp: isLimitUp && samePrice,
    limitUpPrice,
    openedLimitUp,
    qualityIssues: [...new Set(issues)],
    ratePct: policy.ratePct,
    reportedChangePct,
    ruleVersion: policy.ruleVersion,
    touchedLimitUp,
  };
}

function limitFeatureValue(feature, input) {
  const property = LIMIT_FEATURE_PROPERTIES[feature];
  if (!property) throw new TypeError(`Unsupported limit feature: ${feature}`);
  const state = deriveLimitState(input);
  return { state, value: state[property] };
}

module.exports = {
  LIMIT_FEATURES,
  LIMIT_FEATURE_PROPERTIES,
  deriveLimitState,
  limitFeatureValue,
  normalLimitRate,
  roundPrice,
};
