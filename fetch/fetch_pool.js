#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { buildPoolRequest, fetchPool: fetchPoolData } = require("../src/sources/eastmoney/client");
const { formatMarketDate } = require("../src/core/date");

const execFileAsync = promisify(execFile);
const VALID_POOLS = new Set(["dt", "qs", "zb", "zt"]);
const VALID_ENGINES = new Set(["curl", "node"]);
const TRADING_DAYS_SCRIPT = path.resolve(__dirname, "../utils/generate_trading_days.js");

function printUsage() {
  console.error(
    "Usage: node fetch/fetch_pool.js <dt|qs|zb|zt> [YYYYMMDD] [--days <N>] [--json] [--output <file>] [--print-curl] [--engine <curl|node>]"
  );
}

function formatToday(offsetDays = 0, date = new Date()) {
  return formatMarketDate(offsetDays, date);
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
    engine: "curl",
    daysOffset: null,
    outputJson: false,
    outputFile: null,
    printCurl: false,
    positionalArgs: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--json") {
      options.outputJson = true;
      continue;
    }

    if (arg === "--print-curl") {
      options.printCurl = true;
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

    if (arg === "--output" || arg === "-o") {
      const nextArg = argv[index + 1];
      if (!nextArg) {
        throw new Error("Missing value for --output.");
      }

      options.outputFile = path.resolve(nextArg);
      index += 1;
      continue;
    }

    options.positionalArgs.push(arg);
  }

  return options;
}

function defaultDateForPool(pool) {
  return formatToday(0);
}

async function resolveTradingDate(daysOffset, options = {}) {
  const run = options.execFileAsync ?? execFileAsync;
  const warn = options.warn ?? console.error;
  const now = options.now ?? new Date();
  const endDate = formatToday(0, now);
  const startDate = formatToday(-(daysOffset + 14), now);
  let stdout;
  try {
    ({ stdout } = await run(
      "node",
      [TRADING_DAYS_SCRIPT, startDate, endDate, "--json"],
      { maxBuffer: 10 * 1024 * 1024 }
    ));
  } catch (error) {
    if (daysOffset === 0) {
      warn(
        `Trading day lookup failed; falling back to market date ${endDate}: ${error.message}`
      );
      return endDate;
    }
    throw error;
  }

  let tradingDates;
  try {
    tradingDates = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Failed to parse trading days: ${error.message}`);
  }

  if (!Array.isArray(tradingDates) || tradingDates.length === 0) {
    throw new Error("No trading days were returned.");
  }

  const targetIndex = tradingDates.length - 1 - daysOffset;
  if (targetIndex < 0) {
    throw new Error(`Not enough trading days returned for --days ${daysOffset}.`);
  }

  return tradingDates[targetIndex];
}

async function main() {
  const { engine, daysOffset, outputJson, outputFile, printCurl, positionalArgs } = parseArguments(
    process.argv.slice(2)
  );

  if (positionalArgs.length < 1 || positionalArgs.length > 2) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const pool = positionalArgs[0];
  if (!VALID_POOLS.has(pool)) {
    throw new Error(`Invalid pool: ${pool}`);
  }

  if (daysOffset !== null && positionalArgs[1]) {
    throw new Error("YYYYMMDD and --days cannot be used together.");
  }

  const dateValue = positionalArgs[1]
    ? normalizeDate(positionalArgs[1])
    : daysOffset !== null
      ? await resolveTradingDate(daysOffset)
      : defaultDateForPool(pool);
  const request = await buildPoolRequest(pool, dateValue);

  if (printCurl) {
    if (outputFile) {
      await fs.writeFile(outputFile, `${request.commandText}\n`, "utf8");
      console.log(outputFile);
      return;
    }

    process.stdout.write(`${request.commandText}\n`);
    return;
  }

  const data = await fetchPoolData(pool, dateValue);
  const outputText = outputJson
    ? `${JSON.stringify(data, null, 2)}\n`
    : `${JSON.stringify(data)}\n`;

  if (outputFile) {
    await fs.writeFile(outputFile, outputText, "utf8");
    console.log(outputFile);
    return;
  }

  process.stdout.write(outputText);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  formatToday,
  resolveTradingDate,
};
