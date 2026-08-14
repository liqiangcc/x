"use strict";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function normalizeMinDrawdown(value) {
  const normalized = value ?? 0;
  if (!Number.isFinite(normalized) || normalized < 0 || normalized >= 1) {
    throw new TypeError("minDrawdown must be a finite number greater than or equal to 0 and less than 1.");
  }
  return normalized;
}

function normalizePriceField(value) {
  const normalized = String(value ?? "close").trim();
  if (!/^[a-z][a-zA-Z0-9_]*$/.test(normalized)) {
    throw new TypeError("priceField must be a valid field name.");
  }
  return normalized;
}

function normalizePoints(rows, priceField) {
  if (!Array.isArray(rows)) throw new TypeError("rows must be an array.");
  let previousDate = null;
  return rows.map((row, index) => {
    const date = row?.date;
    const price = row?.[priceField];
    if (!ISO_DATE_PATTERN.test(String(date ?? ""))) {
      throw new TypeError(`rows[${index}].date must use YYYY-MM-DD.`);
    }
    if (!Number.isFinite(price) || price <= 0) {
      throw new TypeError(`rows[${index}].${priceField} must be a positive finite number.`);
    }
    if (previousDate !== null && date <= previousDate) {
      throw new TypeError("rows must be strictly ordered by ascending date without duplicates.");
    }
    previousDate = date;
    return { date, index, price };
  });
}

function materializeEvent({ peak, trough, recovery, minDrawdown }) {
  if (!peak || !trough || trough.price >= peak.price) return null;
  const drawdownMagnitude = (peak.price - trough.price) / peak.price;
  if (drawdownMagnitude < minDrawdown) return null;
  return {
    peakDate: peak.date,
    peakPrice: peak.price,
    troughDate: trough.date,
    troughPrice: trough.price,
    drawdown: -drawdownMagnitude,
    peakToTroughTradingDays: trough.index - peak.index,
    recoveryDate: recovery?.date ?? null,
    recoveryTradingDays: recovery ? recovery.index - trough.index : null,
    status: recovery ? "recovered" : "ongoing",
  };
}

function calculateDrawdowns(rows, {
  minDrawdown = 0,
  priceField = "close",
} = {}) {
  const threshold = normalizeMinDrawdown(minDrawdown);
  const field = normalizePriceField(priceField);
  const points = normalizePoints(rows, field);
  if (points.length === 0) return [];

  const events = [];
  let peak = points[0];
  let trough = null;

  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    if (point.price >= peak.price) {
      const event = materializeEvent({ peak, trough, recovery: point, minDrawdown: threshold });
      if (event) events.push(event);
      peak = point;
      trough = null;
      continue;
    }
    if (!trough || point.price < trough.price) trough = point;
  }

  const ongoing = materializeEvent({ peak, trough, recovery: null, minDrawdown: threshold });
  if (ongoing) events.push(ongoing);
  return events;
}

function summarizeDrawdowns(events) {
  if (!Array.isArray(events)) throw new TypeError("events must be an array.");
  const drawdowns = events.map((event) => event?.drawdown).filter(Number.isFinite);
  return {
    eventCount: events.length,
    maxDrawdown: drawdowns.length === 0 ? null : Math.min(...drawdowns),
    ongoingCount: events.filter((event) => event?.status === "ongoing").length,
    recoveredCount: events.filter((event) => event?.status === "recovered").length,
  };
}

module.exports = {
  calculateDrawdowns,
  normalizeMinDrawdown,
  normalizePriceField,
  summarizeDrawdowns,
};
