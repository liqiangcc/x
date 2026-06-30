#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const FETCH_POOL_SCRIPT = path.resolve(__dirname, "./fetch_pool.js");
const TRADING_DAYS_SCRIPT = path.resolve(__dirname, "../utils/generate_trading_days.js");
const VALID_ENGINES = new Set(["curl", "node"]);
const POOLS = ["dt", "qs", "zb", "zt"];

function printUsage() {
  console.error(
    "Usage: node fetch/pull_pool_task.js [YYYYMMDD] [--days <N>] [--range-days <N>] [--engine <curl|node>] [--output-dir <dir>]"
  );
}

function normalizeDate(input) {
  const digits = input.replace(/-/g, "");
  if (!/^\d{8}$/.test(digits)) {
    throw new Error(`Invalid date format: ${input}`);
  }

  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`Invalid calendar date: ${input}`);
  }

  return digits;
}

function parseArguments(argv) {
  const options = {
    daysOffset: null,
    engine: "curl",
    outputDir: path.resolve("pool_data"),
    rangeDays: null,
    positionalArgs: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--days") {
      const nextArg = argv[index + 1];
      if (!nextArg) {
        throw new Error("Missing value for --days.");
      }
      if (!/^\d+$/.test(nextArg)) {
        throw new Error(`Invalid value for --days: ${nextArg}`);
      }

      options.daysOffset = Number(nextArg);
      index += 1;
      continue;
    }

    if (arg === "--engine") {
      const nextArg = argv[index + 1];
      if (!nextArg) {
        throw new Error("Missing value for --engine.");
      }
      if (!VALID_ENGINES.has(nextArg)) {
        throw new Error(`Invalid engine: ${nextArg}`);
      }

      options.engine = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--range-days") {
      const nextArg = argv[index + 1];
      if (!nextArg) {
        throw new Error("Missing value for --range-days.");
      }
      if (!/^\d+$/.test(nextArg) || Number(nextArg) < 1) {
        throw new Error(`Invalid value for --range-days: ${nextArg}`);
      }

      options.rangeDays = Number(nextArg);
      index += 1;
      continue;
    }

    if (arg === "--output-dir") {
      const nextArg = argv[index + 1];
      if (!nextArg) {
        throw new Error("Missing value for --output-dir.");
      }

      options.outputDir = path.resolve(nextArg);
      index += 1;
      continue;
    }

    options.positionalArgs.push(arg);
  }

  return options;
}

function toUtcDate(yyyymmdd) {
  const year = Number(yyyymmdd.slice(0, 4));
  const month = Number(yyyymmdd.slice(4, 6));
  const day = Number(yyyymmdd.slice(6, 8));
  return new Date(Date.UTC(year, month - 1, day));
}

function formatUtcDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function shiftDate(yyyymmdd, offsetDays) {
  const date = toUtcDate(yyyymmdd);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return formatUtcDate(date);
}

function getPoolCount(data) {
  return Array.isArray(data?.data?.pool) ? data.data.pool.length : 0;
}

async function resolveTargetDate(explicitDate, daysOffset) {
  if (explicitDate && daysOffset !== null) {
    throw new Error("YYYYMMDD and --days cannot be used together.");
  }

  if (explicitDate) {
    return normalizeDate(explicitDate);
  }

  const args = ["dt", "--print-curl"];
  if (daysOffset !== null) {
    args.push("--days", String(daysOffset));
  }

  const { stdout } = await execFileAsync("node", [FETCH_POOL_SCRIPT, ...args], {
    maxBuffer: 10 * 1024 * 1024,
  });
  const match = stdout.match(/[?&]date=(\d{8})\b/);
  if (!match) {
    throw new Error("Failed to resolve target date from fetch_pool.js.");
  }

  return match[1];
}

async function resolveTradingDates(targetDate, rangeDays) {
  const paddingDays = Math.max(rangeDays * 3, 14);
  const startDate = shiftDate(targetDate, -paddingDays);
  const { stdout } = await execFileAsync(
    "node",
    [TRADING_DAYS_SCRIPT, startDate, targetDate, "--json"],
    { maxBuffer: 10 * 1024 * 1024 }
  );

  let tradingDates;
  try {
    tradingDates = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Failed to parse trading days: ${error.message}`);
  }

  if (!Array.isArray(tradingDates) || tradingDates.length === 0) {
    throw new Error("No trading days were returned for the requested range.");
  }

  if (tradingDates[tradingDates.length - 1] !== targetDate) {
    throw new Error(`Target date ${targetDate} is not a trading day.`);
  }

  if (tradingDates.length < rangeDays) {
    throw new Error(`Not enough trading days returned for --range-days ${rangeDays}.`);
  }

  return tradingDates.slice(-rangeDays);
}

async function fetchPool(pool, targetDate, engine) {
  const enginesToTry = [engine, ...[...VALID_ENGINES].filter((candidate) => candidate !== engine)];
  let lastError;

  for (const currentEngine of enginesToTry) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const { stdout } = await execFileAsync(
          "node",
          [FETCH_POOL_SCRIPT, pool, targetDate, "--engine", currentEngine, "--json"],
          { maxBuffer: 20 * 1024 * 1024 }
        );

        return {
          data: JSON.parse(stdout),
          engineUsed: currentEngine,
        };
      } catch (error) {
        lastError = error;
        if (attempt < 3) {
          await new Promise((resolve) => {
            setTimeout(resolve, attempt * 500);
          });
        }
      }
    }
  }

  throw lastError;
}

async function main() {
  const { daysOffset, engine, outputDir, rangeDays, positionalArgs } = parseArguments(
    process.argv.slice(2)
  );

  if (positionalArgs.length > 1) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const targetDate = await resolveTargetDate(positionalArgs[0], daysOffset);
  const datesToFetch = rangeDays ? await resolveTradingDates(targetDate, rangeDays) : [targetDate];
  const executionDates = [...datesToFetch].reverse();
  const runRoot = outputDir;
  await fs.mkdir(runRoot, { recursive: true });

  const summary = {
    requested_date: targetDate,
    range_days: rangeDays ?? 1,
    engine,
    stats: {
      success: 0,
      failed: 0,
      skipped_dates: 0,
    },
    dates: {},
  };

  let hitEmptyBoundary = false;
  for (const currentDate of executionDates) {
    if (hitEmptyBoundary) {
      summary.dates[currentDate] = {
        status: "skipped",
        reason: "older_than_empty_boundary",
      };
      summary.stats.skipped_dates += 1;
      continue;
    }

    const runDir = path.join(runRoot, currentDate);
    await fs.mkdir(runDir, { recursive: true });
    summary.dates[currentDate] = {
      status: "completed",
      pools: {},
    };

    let dateAllSucceeded = true;
    let dateAllEmpty = true;
    for (const pool of POOLS) {
      try {
        const { data, engineUsed } = await fetchPool(pool, currentDate, engine);
        const outputPath = path.join(runDir, `${pool}.json`);
        await fs.writeFile(outputPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
        const count = getPoolCount(data);

        summary.dates[currentDate].pools[pool] = {
          status: "success",
          engine_used: engineUsed,
          file: outputPath,
          qdate: data?.data?.qdate ?? null,
          count,
          rc: data?.rc ?? null,
        };
        summary.stats.success += 1;
        if (count > 0) {
          dateAllEmpty = false;
        }
      } catch (error) {
        summary.dates[currentDate].pools[pool] = {
          status: "failed",
          error: error.message,
        };
        summary.stats.failed += 1;
        dateAllSucceeded = false;
        dateAllEmpty = false;
      }
    }

    if (dateAllSucceeded && dateAllEmpty) {
      summary.dates[currentDate].status = "empty_boundary";
      hitEmptyBoundary = true;
    }
  }

  const summaryPath = path.join(runRoot, "summary.json");
  await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(runRoot);

  if (summary.stats.failed > 0) {
    console.error(`Completed with ${summary.stats.failed} failed pool fetches. See ${summaryPath}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
