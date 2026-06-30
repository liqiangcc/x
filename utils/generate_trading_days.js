#!/usr/bin/env node

const { execFile } = require("node:child_process");
const path = require("node:path");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const API_SCRIPT = path.resolve(__dirname, "../api/call_ttjj_api.sh");
const DEFAULT_SECID = "1.000001";

function printUsage() {
  console.error(
    "Usage: node utils/generate_trading_days.js <start_date> <end_date> [--json] [--output <file>]"
  );
  console.error("Date format: YYYYMMDD or YYYY-MM-DD");
}

function normalizeDate(input) {
  const digits = input.replace(/-/g, "");
  if (!/^\d{8}$/.test(digits)) {
    throw new Error(`Invalid date format: ${input}`);
  }

  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  const utcDate = new Date(Date.UTC(year, month - 1, day));

  if (
    utcDate.getUTCFullYear() !== year ||
    utcDate.getUTCMonth() !== month - 1 ||
    utcDate.getUTCDate() !== day
  ) {
    throw new Error(`Invalid calendar date: ${input}`);
  }

  return digits;
}

function toUtcDate(yyyymmdd) {
  const year = Number(yyyymmdd.slice(0, 4));
  const month = Number(yyyymmdd.slice(4, 6));
  const day = Number(yyyymmdd.slice(6, 8));
  return new Date(Date.UTC(year, month - 1, day));
}

function calculateLimit(startDate, endDate) {
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  const diffDays = Math.floor((toUtcDate(endDate) - toUtcDate(startDate)) / millisecondsPerDay);
  return Math.max(diffDays + 1, 1);
}

function extractTradingDates(apiResponse, startDate, endDate) {
  const klines = apiResponse?.data?.klines;
  if (!Array.isArray(klines)) {
    throw new Error("API response does not contain kline data.");
  }

  return klines
    .map((line) => String(line).split(",")[0]?.replace(/-/g, ""))
    .filter((date) => /^\d{8}$/.test(date) && date >= startDate && date <= endDate);
}

function parseArguments(argv) {
  const options = {
    outputJson: false,
    outputFile: null,
    positionalArgs: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--json") {
      options.outputJson = true;
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

async function fetchTradingDates(startDate, endDate) {
  const limit = String(calculateLimit(startDate, endDate));
  const { stdout, stderr } = await execFileAsync(API_SCRIPT, [
    "get_kline",
    DEFAULT_SECID,
    "101",
    limit,
    endDate,
  ]);

  if (stderr && stderr.trim()) {
    throw new Error(stderr.trim());
  }

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Failed to parse API response: ${error.message}`);
  }

  return extractTradingDates(parsed, startDate, endDate);
}

async function main() {
  const args = process.argv.slice(2);
  const { outputJson, outputFile, positionalArgs } = parseArguments(args);

  if (positionalArgs.length !== 2) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const startDate = normalizeDate(positionalArgs[0]);
  const endDate = normalizeDate(positionalArgs[1]);

  if (startDate > endDate) {
    throw new Error("start_date must be earlier than or equal to end_date.");
  }

  const tradingDates = await fetchTradingDates(startDate, endDate);
  const outputText = outputJson
    ? `${JSON.stringify(tradingDates, null, 2)}\n`
    : tradingDates.length > 0
      ? `${tradingDates.join("\n")}\n`
      : "";

  if (outputFile) {
    const fs = require("node:fs/promises");
    await fs.writeFile(outputFile, outputText, "utf8");
    console.log(outputFile);
    return;
  }

  if (outputText) {
    process.stdout.write(outputText);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
