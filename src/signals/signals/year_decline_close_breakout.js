"use strict";

const REQUIRED_COMPLETE_YEARS = 4;

function finite(value) {
  return Number.isFinite(value);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function evaluateYearDeclineCloseBreakout(context) {
  const today = context?.features?.today ?? null;
  const currentYear = Number(String(context?.isoDate ?? today?.date ?? "").slice(0, 4));
  const requiredYears = Number.isInteger(currentYear)
    ? Array.from({ length: REQUIRED_COMPLETE_YEARS }, (_, index) => currentYear - REQUIRED_COMPLETE_YEARS + index)
    : [];
  const completedByYear = new Map(
    (context?.features?.completedYears ?? []).map((bar) => [Number(bar.year), bar]),
  );
  const annualPoints = requiredYears.map((year) => completedByYear.get(year) ?? null);
  const qualityIssues = [];

  if (requiredYears.length !== REQUIRED_COMPLETE_YEARS || annualPoints.some((point) => !point || !finite(point.close) || !finite(point.high))) {
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

  const consecutiveDecline = annualPoints.length === REQUIRED_COMPLETE_YEARS
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
      required_complete_years: REQUIRED_COMPLETE_YEARS,
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
  yearDeclineCloseBreakoutSignal,
};
