#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

function printUsage() {
  console.error(
    "Usage: node process/select_limit_up_year_breakout.js <YYYYMMDD> [--pool-dir <dir>] [--daily-dir <dir>] [--yearly-dir <dir>] [--pool <zt,zb,...>] [--json]"
  );
}

function parseArguments(argv) {
  const options = {
    dailyDir: path.resolve("data/kline/daily"),
    date: null,
    json: false,
    pools: ["zt", "zb"],
    poolDir: path.resolve("data/pool"),
    yearlyDir: path.resolve("data/kline/yearly"),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--pool-dir") {
      const nextArg = argv[index + 1];
      if (!nextArg) {
        throw new Error("Missing value for --pool-dir.");
      }
      options.poolDir = path.resolve(nextArg);
      index += 1;
      continue;
    }

    if (arg === "--daily-dir") {
      const nextArg = argv[index + 1];
      if (!nextArg) {
        throw new Error("Missing value for --daily-dir.");
      }
      options.dailyDir = path.resolve(nextArg);
      index += 1;
      continue;
    }

    if (arg === "--yearly-dir") {
      const nextArg = argv[index + 1];
      if (!nextArg) {
        throw new Error("Missing value for --yearly-dir.");
      }
      options.yearlyDir = path.resolve(nextArg);
      index += 1;
      continue;
    }

    if (arg === "--pool") {
      const nextArg = argv[index + 1];
      if (!nextArg) {
        throw new Error("Missing value for --pool.");
      }
      const pools = nextArg
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      const validPools = new Set(["zt", "zb"]);
      if (pools.length === 0 || pools.some((item) => !validPools.has(item))) {
        throw new Error(`Invalid value for --pool: ${nextArg}`);
      }
      options.pools = [...new Set(pools)];
      index += 1;
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (options.date) {
      throw new Error("Only one date is supported.");
    }

    options.date = arg;
  }

  if (!options.date || !/^\d{8}$/.test(options.date)) {
    printUsage();
    throw new Error("A trading date in YYYYMMDD format is required.");
  }

  return options;
}

function normalizePrice(value) {
  return typeof value === "number" ? value / 1000 : null;
}

function parseKlineRow(row) {
  const parts = String(row).split(",");
  if (parts.length < 5) {
    return null;
  }

  return {
    date: parts[0],
    open: Number(parts[1]),
    close: Number(parts[2]),
    high: Number(parts[3]),
    low: Number(parts[4]),
  };
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function toIsoDate(compactDate) {
  return `${compactDate.slice(0, 4)}-${compactDate.slice(4, 6)}-${compactDate.slice(6, 8)}`;
}

function previousYearEnd(isoDate) {
  const year = Number(isoDate.slice(0, 4)) - 1;
  return `${year}-12-31`;
}

function buildDailyIndex(klines) {
  const map = new Map();
  for (const row of klines) {
    const parsed = parseKlineRow(row);
    if (parsed) {
      map.set(parsed.date, parsed);
    }
  }
  return map;
}

function getPreviousTradingDay(index, currentDate) {
  const dates = [...index.keys()].filter((item) => item < currentDate).sort();
  if (dates.length === 0) {
    return null;
  }
  return index.get(dates[dates.length - 1]) ?? null;
}

function getHistoricalHighBeforeYear(index, currentDate) {
  const currentYear = Number(currentDate.slice(0, 4));
  const cutoffDate = `${currentYear - 1}-01-01`;
  let maxHigh = null;
  for (const [date, row] of index.entries()) {
    if (date >= cutoffDate) {
      continue;
    }
    if (maxHigh === null || row.high > maxHigh) {
      maxHigh = row.high;
    }
  }
  return maxHigh;
}

function getPreviousYearHigh(klines, targetDate) {
  const previousYearDate = previousYearEnd(targetDate);
  for (const row of klines) {
    const parsed = parseKlineRow(row);
    if (parsed?.date === previousYearDate) {
      return parsed.high;
    }
  }
  return null;
}

function formatValue(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  return String(value);
}

function renderTable(records) {
  const columns = [
    ["pool_type", "Pool"],
    ["code", "Code"],
    ["name", "Name"],
    ["price", "Price"],
    ["today_high", "TodayHigh"],
    ["yesterday_high", "YestHigh"],
    ["prev_year_high", "PrevYearHigh"],
    ["this_year_exceedance_index", "Count"],
    ["sector", "Sector"],
  ];

  const widths = columns.map(([key, label]) =>
    Math.max(label.length, ...records.map((record) => formatValue(record[key]).length))
  );

  const lines = [];
  lines.push(columns.map(([, label], index) => label.padEnd(widths[index])).join("  "));
  lines.push(widths.map((width) => "-".repeat(width)).join("  "));
  for (const record of records) {
    lines.push(columns.map(([key], index) => formatValue(record[key]).padEnd(widths[index])).join("  "));
  }
  return lines.join("\n");
}

async function pickMatches(options) {
  const isoDate = toIsoDate(options.date);
  const poolItems = [];
  const seenCodes = new Set();
  for (const poolType of options.pools) {
    const poolPath = path.join(options.poolDir, options.date, `${poolType}.json`);
    const payload = await readJson(poolPath);
    const items = Array.isArray(payload?.data?.pool) ? payload.data.pool : [];
    for (const item of items) {
      if (!item?.c || seenCodes.has(item.c)) {
        continue;
      }
      seenCodes.add(item.c);
      poolItems.push({
        ...item,
        pool_type: poolType,
      });
    }
  }
  const matches = [];
  const skipped = [];

  for (const item of poolItems) {
    const code = item?.c;
    if (!code) {
      continue;
    }

    const dailyPath = path.join(options.dailyDir, `${code}.json`);
    const yearlyPath = path.join(options.yearlyDir, `${code}.json`);

    let dailyPayload;
    let yearlyPayload;
    try {
      dailyPayload = await readJson(dailyPath);
      yearlyPayload = await readJson(yearlyPath);
    } catch (error) {
      skipped.push({ code, reason: `missing_kline: ${error.message}` });
      continue;
    }

    const dailyKlines = Array.isArray(dailyPayload?.data?.klines) ? dailyPayload.data.klines : [];
    const yearlyKlines = Array.isArray(yearlyPayload?.data?.klines) ? yearlyPayload.data.klines : [];
    const dailyIndex = buildDailyIndex(dailyKlines);
    const todayRow = dailyIndex.get(isoDate);
    const yesterdayRow = getPreviousTradingDay(dailyIndex, isoDate);
    const historicalHighBeforeLastYear = getHistoricalHighBeforeYear(dailyIndex, isoDate);
    const prevYearHigh = getPreviousYearHigh(yearlyKlines, isoDate);

    if (!todayRow || !yesterdayRow || prevYearHigh === null || historicalHighBeforeLastYear === null) {
      skipped.push({
        code,
        reason: "insufficient_history",
      });
      continue;
    }

    if (!(yesterdayRow.high < prevYearHigh && todayRow.high > prevYearHigh)) {
      continue;
    }

    if (todayRow.high > historicalHighBeforeLastYear) {
      continue;
    }

    // Call helper to compute this year's exceedance dates (over prevYearHigh)
    let thisYearExceedanceIndex = 0;
    let thisYearExceedanceDates = [];
    try {
      const helperPath = path.join(__dirname, "get_year_exceed_dates.js");
      const out = execFileSync("node", [helperPath, code, String(prevYearHigh), isoDate, "--daily-dir", options.dailyDir], {
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
      });
      const parsedHelper = JSON.parse(out);
      thisYearExceedanceIndex = parsedHelper.count ?? (Array.isArray(parsedHelper.exceed_dates) ? parsedHelper.exceed_dates.length : 0);
      thisYearExceedanceDates = parsedHelper.exceed_dates ?? [];
    } catch (e) {
      // ignore helper errors and continue with defaults
    }

    matches.push({
      code,
      name: item.n ?? null,
      pool_type: item.pool_type ?? null,
      sector: item.hybk ?? null,
      price: todayRow.close,
      today_high: todayRow.high,
      yesterday_high: yesterdayRow.high,
      prev_year_high: prevYearHigh,
      this_year_exceedance_index: thisYearExceedanceIndex,
      this_year_exceedance_dates: thisYearExceedanceDates,
      event_date: isoDate,
    });
  }

  matches.sort((left, right) => {
    const sectorCompare = String(left.sector ?? "").localeCompare(String(right.sector ?? ""));
    if (sectorCompare !== 0) {
      return sectorCompare;
    }
    return left.code.localeCompare(right.code);
  });
  return {
    date: options.date,
    iso_date: isoDate,
    pools: options.pools,
    total_candidates: poolItems.length,
    matched_count: matches.length,
    matches,
    skipped,
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const result = await pickMatches(options);

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  console.log(`Date: ${result.date}`);
  console.log(`Pools: ${result.pools.join(",")}`);
  console.log(`Total candidates: ${result.total_candidates}`);
  console.log(`Matched: ${result.matched_count}`);
  if (result.matches.length === 0) {
    return;
  }

  console.log("");
  console.log(renderTable(result.matches));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
