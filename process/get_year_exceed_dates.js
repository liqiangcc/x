#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");

function printUsage() {
  console.error("Usage: node process/get_year_exceed_dates.js <code> <prev_year_high> [<end_date YYYYMMDD or YYYY-MM-DD>] [--daily-dir <dir>]");
}

function parseKlineRow(row) {
  const parts = String(row).split(",");
  if (parts.length < 5) return null;
  return {
    date: parts[0],
    open: Number(parts[1]),
    close: Number(parts[2]),
    high: Number(parts[3]),
    low: Number(parts[4]),
  };
}

function toIsoDate(compact) {
  if (!compact) return null;
  if (/^\d{8}$/.test(compact)) {
    return `${compact.slice(0,4)}-${compact.slice(4,6)}-${compact.slice(6,8)}`;
  }
  return compact;
}

(async function main() {
  try {
    const argv = process.argv.slice(2);
    if (argv.length < 2) {
      printUsage();
      process.exit(1);
    }
    let code = argv[0];
    const prevYearHigh = Number(argv[1]);
    if (Number.isNaN(prevYearHigh)) {
      console.error("Invalid prev_year_high");
      process.exit(1);
    }
    let endDateArg = argv[2] ?? null;
    let dailyDir = path.resolve("data/kline/daily");

    // parse optional flags
    for (let i = 2; i < argv.length; i++) {
      const a = argv[i];
      if (a === "--daily-dir") {
        const v = argv[i+1];
        if (!v) { console.error("Missing value for --daily-dir"); process.exit(1); }
        dailyDir = path.resolve(v);
        i++;
        continue;
      }
      // first non-flag after code and prevYearHigh may be endDate
      if (!endDateArg && !a.startsWith("--")) {
        endDateArg = a;
      }
    }

    const isoEnd = toIsoDate(endDateArg) || new Date().toISOString().slice(0,10);
    const year = Number(isoEnd.slice(0,4));
    const yearStart = `${year}-01-01`;

    const filePath = path.join(dailyDir, `${code}.json`);
    const raw = await fs.readFile(filePath, "utf8");
    const payload = JSON.parse(raw);
    const klines = Array.isArray(payload?.data?.klines) ? payload.data.klines : [];

    const parsedRows = [];
    for (const row of klines) {
      const parsed = parseKlineRow(row);
      if (!parsed) continue;
      parsedRows.push(parsed);
    }

    // Sort by date ascending to determine previous trading day correctly
    parsedRows.sort((a, b) => a.date.localeCompare(b.date));

    const exceedDates = [];
    for (let i = 1; i < parsedRows.length; i += 1) {
      const prev = parsedRows[i - 1];
      const curr = parsedRows[i];
      // only consider current rows within the year range
      if (curr.date < yearStart || curr.date > isoEnd) continue;
      if (
        typeof prev.high === "number" &&
        typeof curr.high === "number" &&
        prev.high < prevYearHigh &&
        curr.high > prevYearHigh
      ) {
        exceedDates.push(curr.date);
      }
    }

    const result = { code, prev_year_high: prevYearHigh, exceed_dates: exceedDates, count: exceedDates.length };
    process.stdout.write(JSON.stringify(result));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
})();
