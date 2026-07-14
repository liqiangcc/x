"use strict";

function hasEligibleYear(yearlyBars, targetYears, downTransitions = 3) {
  const byYear = new Map(yearlyBars.map((bar) => [Number(bar.date.slice(0, 4)), bar]));
  return targetYears.some((year) => {
    const requiredYears = downTransitions + 1;
    const points = Array.from({ length: requiredYears }, (_item, index) => byYear.get(year - requiredYears + index));
    return points.every((point) => Number.isFinite(point?.close) && Number.isFinite(point?.high))
      && points.slice(1).every((point, index) => point.close < points[index].close);
  });
}

module.exports = {
  hasEligibleYear,
};
