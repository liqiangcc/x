"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { splitSecid } = require("../core/secid");
const { mapConcurrent, normalizeDate, uniqueCodes } = require("./code_universe");
const { klinePaths } = require("../simulator/adapters/ledger/existing_kline_repository");

function parseKlineRow(row) {
  if (typeof row !== "string") return null;
  const fields = row.split(",");
  if (fields.length < 11 || !/^\d{4}-\d{2}-\d{2}$/.test(fields[0])) return null;
  const values = fields.slice(1, 11).map(Number);
  if (!values.every(Number.isFinite)) return null;
  return {
    raw: row,
    date: fields[0],
    open: values[0],
    close: values[1],
    high: values[2],
    low: values[3],
    volume: values[4],
    amount: values[5],
    turnover: values[9],
  };
}

function numberText(value, digits = 2) {
  return Number(value.toFixed(digits)).toString();
}

function aggregateYearRows(rows, { previousClose = null, targetYear } = {}) {
  const yearRows = rows.filter((row) => row && Number(row.date.slice(0, 4)) === targetYear)
    .sort((left, right) => left.date.localeCompare(right.date));
  if (yearRows.length === 0) return null;
  const first = yearRows[0];
  const last = yearRows.at(-1);
  const high = Math.max(...yearRows.map((row) => row.high));
  const low = Math.min(...yearRows.map((row) => row.low));
  const volume = yearRows.reduce((sum, row) => sum + row.volume, 0);
  const amount = yearRows.reduce((sum, row) => sum + row.amount, 0);
  const turnover = yearRows.reduce((sum, row) => sum + row.turnover, 0);
  const reference = Number.isFinite(previousClose) && previousClose > 0 ? previousClose : first.open;
  const amplitude = reference > 0 ? ((high - low) / reference) * 100 : 0;
  const changeAmount = last.close - reference;
  const changePct = reference > 0 ? (changeAmount / reference) * 100 : 0;
  return [
    last.date,
    numberText(first.open),
    numberText(last.close),
    numberText(high),
    numberText(low),
    numberText(volume, 0),
    numberText(amount),
    numberText(amplitude),
    numberText(changePct),
    numberText(changeAmount),
    numberText(turnover),
  ].join(",");
}

function extractRows(payload) {
  if (Array.isArray(payload?.klines)) return payload.klines;
  if (Array.isArray(payload?.data?.klines)) return payload.data.klines;
  return [];
}

function replaceRows(payload, rows, { code, market }) {
  const meta = { ...(payload?.meta ?? {}), aggregated_from: "daily", klt: 106 };
  if (payload?.data || !Array.isArray(payload?.klines)) {
    return {
      ...(payload ?? {}),
      meta,
      data: { ...(payload?.data ?? {}), code, market, klines: rows },
    };
  }
  return { ...payload, code, market, meta, period: "yearly", klines: rows };
}

async function loadFirst(paths) {
  for (const filePath of paths) {
    try {
      return { filePath, payload: JSON.parse(await fs.readFile(filePath, "utf8")) };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return null;
}

async function atomicWrite(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.rename(temporary, filePath);
}

async function aggregateCodeFromDaily({ code: inputCode, klineRoot, targetDate }) {
  const security = splitSecid(inputCode);
  const daily = await loadFirst(klinePaths(klineRoot, "daily", security.code));
  if (!daily) return { code: security.code, reason: "missing_daily", status: "skipped" };
  const dailyRows = extractRows(daily.payload).map(parseKlineRow).filter(Boolean)
    .filter((row) => row.date <= targetDate);
  const latest = dailyRows.at(-1);
  if (latest?.date !== targetDate) return { code: security.code, reason: "target_daily_bar_missing", status: "skipped" };
  const targetYear = Number(targetDate.slice(0, 4));
  const previousClose = dailyRows.filter((row) => Number(row.date.slice(0, 4)) < targetYear).at(-1)?.close ?? null;
  const aggregated = aggregateYearRows(dailyRows, { previousClose, targetYear });
  if (!aggregated) return { code: security.code, reason: "target_year_daily_bars_missing", status: "skipped" };

  const yearlyPaths = klinePaths(klineRoot, "yearly", security.code);
  const yearly = await loadFirst(yearlyPaths);
  const existingCurrentYear = extractRows(yearly?.payload).map(parseKlineRow).filter(Boolean)
    .filter((row) => Number(row.date.slice(0, 4)) === targetYear)
    .sort((left, right) => left.date.localeCompare(right.date)).at(-1);
  if (existingCurrentYear?.date > targetDate) {
    return { code: security.code, reason: "newer_yearly_bar_exists", status: "skipped" };
  }
  const existingRows = extractRows(yearly?.payload).filter((row) => {
    const parsed = parseKlineRow(row);
    return parsed && Number(parsed.date.slice(0, 4)) !== targetYear;
  });
  const mergedRows = [...existingRows, aggregated].sort((left, right) => left.split(",")[0].localeCompare(right.split(",")[0]));
  const outputPath = yearly?.filePath ?? yearlyPaths[0];
  const payload = replaceRows(yearly?.payload ?? {}, mergedRows, security);
  await atomicWrite(outputPath, payload);
  return { code: security.code, outputPath, status: "updated" };
}

async function aggregateYearlyFromDaily({
  codes,
  concurrency = 16,
  klineRoot = path.join("data", "kline"),
  targetDate,
} = {}) {
  const date = normalizeDate(targetDate);
  const results = await mapConcurrent(uniqueCodes(codes), concurrency, async (code) => {
    try {
      return await aggregateCodeFromDaily({ code, klineRoot, targetDate: date });
    } catch (error) {
      return { code, error: error.message, reason: "aggregation_failed", status: "failed" };
    }
  });
  return {
    targetDate: date,
    total: results.length,
    updated: results.filter((item) => item.status === "updated").length,
    skipped: results.filter((item) => item.status === "skipped").length,
    failed: results.filter((item) => item.status === "failed").length,
    items: results,
  };
}

module.exports = {
  aggregateCodeFromDaily,
  aggregateYearRows,
  aggregateYearlyFromDaily,
  extractRows,
  parseKlineRow,
  replaceRows,
};
