"use strict";

const REQUIRED_COMPLETE_YEARS = 4;

function normalizeYearDeclineConfig(input = {}) {
  const downTransitions = input.downTransitions ?? 3;
  if (!Number.isInteger(downTransitions) || downTransitions < 1 || downTransitions > 20) {
    throw new TypeError("downTransitions must be an integer between 1 and 20.");
  }
  const requireConsecutiveCalendarYears = input.requireConsecutiveCalendarYears ?? true;
  if (requireConsecutiveCalendarYears !== true) {
    throw new TypeError("Only consecutive calendar years are currently supported.");
  }
  const firstBreakoutScope = input.firstBreakoutScope ?? "current_year";
  if (firstBreakoutScope !== "current_year") throw new TypeError("firstBreakoutScope must be current_year.");
  const breakoutOperator = input.breakoutOperator ?? "gt";
  if (breakoutOperator !== "gt") throw new TypeError("breakoutOperator must be gt.");
  return Object.freeze({ breakoutOperator, downTransitions, firstBreakoutScope, requireConsecutiveCalendarYears });
}

function finite(value) {
  return Number.isFinite(value);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function evaluateYearDeclineCloseBreakout(context, inputConfig = {}) {
  const config = normalizeYearDeclineConfig(inputConfig);
  const requiredCompleteYears = config.downTransitions + 1;
  const today = context?.features?.today ?? null;
  const currentYear = Number(String(context?.isoDate ?? today?.date ?? "").slice(0, 4));
  const requiredYears = Number.isInteger(currentYear)
    ? Array.from({ length: requiredCompleteYears }, (_, index) => currentYear - requiredCompleteYears + index)
    : [];
  const completedByYear = new Map(
    (context?.features?.completedYears ?? []).map((bar) => [Number(bar.year), bar]),
  );
  const annualPoints = requiredYears.map((year) => completedByYear.get(year) ?? null);
  const qualityIssues = [];

  if (requiredYears.length !== requiredCompleteYears || annualPoints.some((point) => !point || !finite(point.close) || !finite(point.high))) {
    qualityIssues.push("insufficient_consecutive_complete_years");
  }
  if (!today || !finite(today.close) || !today.date) {
    qualityIssues.push("missing_report_date_row");
  }

  const previousYear = annualPoints.at(-1);
  const previousYearHigh = finite(previousYear?.high) ? previousYear.high : null;
  const currentYearPrefix = `${currentYear}-`;
  const previousCurrentYearCloses = (context?.dailyRows ?? [])
    .filter((bar) => bar?.date?.startsWith(currentYearPrefix) && bar.date < today?.date && finite(bar.close))
    .map((bar) => bar.close);
  const maxPreviousCurrentYearClose = previousCurrentYearCloses.length > 0
    ? Math.max(...previousCurrentYearCloses)
    : null;

  const consecutiveDecline = annualPoints.length === requiredCompleteYears
    && annualPoints.every(Boolean)
    && annualPoints.slice(1).every((point, index) => point.close < annualPoints[index].close);
  const neverClosedAbove = previousYearHigh !== null
    && previousCurrentYearCloses.every((close) => close <= previousYearHigh);
  const breakout = previousYearHigh !== null && finite(today?.close) && today.close > previousYearHigh;
  const margin = breakout ? today.close - previousYearHigh : null;
  const marginPct = breakout ? (margin / previousYearHigh) * 100 : null;

  return {
    evidence: {
      annual_points: annualPoints.filter(Boolean).map((point) => ({
        close: point.close,
        high: point.high,
        year: point.year,
      })),
      breakout_margin: margin,
      breakout_margin_pct: marginPct,
      max_previous_current_year_close: maxPreviousCurrentYearClose,
      previous_year_high: previousYearHigh,
      down_transitions: config.downTransitions,
      required_complete_years: requiredCompleteYears,
      rule_summary: `${requiredCompleteYears}个完整年度收盘逐年降低，当前年度首次收盘突破去年最高价`,
      today_close: today?.close ?? null,
      today_date: today?.date ?? null,
    },
    ok: qualityIssues.length === 0 && consecutiveDecline && neverClosedAbove && breakout,
    qualityIssues: unique(qualityIssues),
  };
}

const yearDeclineCloseBreakoutSignal = {
  category: "price",
  defaultScore: 50,
  evaluate: evaluateYearDeclineCloseBreakout,
  id: "year_decline_close_breakout",
};

module.exports = {
  REQUIRED_COMPLETE_YEARS,
  evaluateYearDeclineCloseBreakout,
  normalizeYearDeclineConfig,
  yearDeclineCloseBreakoutSignal,
};
