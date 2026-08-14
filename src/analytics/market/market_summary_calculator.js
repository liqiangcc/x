"use strict";

function assertBars(bars) {
  if (!Array.isArray(bars)) throw new TypeError("bars must be an array.");
  return bars;
}

function finitePrice(value) {
  return Number.isFinite(value) ? value : null;
}

function priceExtreme(bars, field, compare) {
  let selected = null;
  for (const bar of bars) {
    const price = finitePrice(bar?.[field]);
    if (price === null) continue;
    if (!selected || compare(price, selected.price)) {
      selected = { date: bar?.date ?? null, price };
    }
  }
  return selected;
}

function calculateMarketSummary(bars) {
  const source = assertBars(bars);
  const firstBar = source[0] ?? null;
  const lastBar = source.at(-1) ?? null;
  const closeBars = source.filter((bar) => Number.isFinite(bar?.close));
  const firstCloseBar = closeBars[0] ?? null;
  const lastCloseBar = closeBars.at(-1) ?? null;
  const firstClose = finitePrice(firstCloseBar?.close);
  const lastClose = finitePrice(lastCloseBar?.close);
  const returnRate = firstClose !== null && firstClose !== 0 && lastClose !== null
    ? (lastClose / firstClose) - 1
    : null;

  return {
    latest: lastCloseBar
      ? { date: lastCloseBar.date ?? null, close: lastClose }
      : null,
    range: {
      firstDate: firstCloseBar?.date ?? null,
      lastDate: lastCloseBar?.date ?? null,
      firstClose,
      lastClose,
      returnRate,
      high: priceExtreme(source, "high", (candidate, current) => candidate > current),
      low: priceExtreme(source, "low", (candidate, current) => candidate < current),
    },
    coverage: {
      barCount: source.length,
      observedStartDate: firstBar?.date ?? null,
      observedEndDate: lastBar?.date ?? null,
    },
  };
}

module.exports = {
  assertBars,
  calculateMarketSummary,
  finitePrice,
  priceExtreme,
};
