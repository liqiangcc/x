"use strict";

function toIsoDate(date) {
  const digits = String(date ?? "").replace(/-/g, "");
  if (!/^\d{8}$/.test(digits)) {
    throw new Error(`Invalid signal date: ${date}`);
  }
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function isValidIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""));
}

function parseNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseKlineRow(row) {
  const fields = String(row ?? "").split(",");
  if (fields.length < 7 || !isValidIsoDate(fields[0])) {
    return { issue: "invalid_kline", row: null };
  }

  const parsed = {
    date: fields[0],
    open: parseNumber(fields[1]),
    close: parseNumber(fields[2]),
    high: parseNumber(fields[3]),
    low: parseNumber(fields[4]),
    volume: parseNumber(fields[5]),
    amount: parseNumber(fields[6]),
  };

  if (![parsed.open, parsed.close, parsed.high, parsed.low, parsed.volume, parsed.amount].every(Number.isFinite)) {
    return { issue: "invalid_kline", row: null };
  }

  return { issue: null, row: parsed };
}

function normalizeKlineRows(rows) {
  const issues = [];
  const parsedRows = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const parsed = parseKlineRow(row);
    if (parsed.issue) {
      issues.push(parsed.issue);
      continue;
    }
    parsedRows.push(parsed.row);
  }
  parsedRows.sort((left, right) => left.date.localeCompare(right.date));
  return { issues, rows: parsedRows };
}

function average(rows, field) {
  const values = rows.map((row) => row?.[field]).filter(Number.isFinite);
  if (values.length !== rows.length || values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function movingAverage(rows, endIndex, size, field = "close") {
  if (!Number.isInteger(endIndex) || endIndex < size - 1) {
    return null;
  }
  return average(rows.slice(endIndex - size + 1, endIndex + 1), field);
}

function priorAverage(rows, endIndex, size, field) {
  if (!Number.isInteger(endIndex) || endIndex < size) {
    return null;
  }
  return average(rows.slice(endIndex - size, endIndex), field);
}

function findPreviousYearBar(yearlyRows, isoDate) {
  const previousYear = Number(isoDate.slice(0, 4)) - 1;
  const matches = yearlyRows
    .filter((row) => row.date.slice(0, 4) === String(previousYear))
    .sort((left, right) => left.date.localeCompare(right.date));

  const row = matches[matches.length - 1] ?? null;
  if (!row) {
    return null;
  }

  return {
    close: row.close,
    date: row.date,
    high: row.high,
    year: previousYear,
  };
}

function buildFeatures({ dailyRows = [], isoDate, yearlyRows = [] }) {
  const issues = [];
  if (!Array.isArray(dailyRows) || dailyRows.length === 0) {
    issues.push("missing_daily_kline");
  }
  if (!Array.isArray(yearlyRows) || yearlyRows.length === 0) {
    issues.push("missing_yearly_kline");
  }

  const daily = normalizeKlineRows(dailyRows);
  const yearly = normalizeKlineRows(yearlyRows);
  issues.push(...daily.issues, ...yearly.issues);

  const todayIndex = daily.rows.findIndex((row) => row.date === isoDate);
  const today = todayIndex >= 0 ? daily.rows[todayIndex] : null;
  const previousTradingDay = todayIndex > 0 ? daily.rows[todayIndex - 1] : null;
  const previousYear = findPreviousYearBar(yearly.rows, isoDate);

  if (!today) {
    issues.push("missing_report_date_row");
  }
  if (!previousTradingDay) {
    issues.push("missing_previous_trading_day");
  }
  if (!previousYear) {
    issues.push("missing_previous_year_bar");
  }

  return {
    dailyRows: daily.rows,
    features: {
      averageAmount20: todayIndex >= 0 ? priorAverage(daily.rows, todayIndex, 20, "amount") : null,
      ma20: todayIndex >= 0 ? movingAverage(daily.rows, todayIndex, 20, "close") : null,
      ma60: todayIndex >= 0 ? movingAverage(daily.rows, todayIndex, 60, "close") : null,
      previousTradingDay,
      previousYear,
      today,
    },
    issues: [...new Set(issues)],
    yearlyRows: yearly.rows,
  };
}

module.exports = {
  buildFeatures,
  findPreviousYearBar,
  movingAverage,
  normalizeKlineRows,
  parseKlineRow,
  priorAverage,
  toIsoDate,
};
