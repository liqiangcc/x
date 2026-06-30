#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const VALID_POOLS = new Set(["dt", "qs", "zb", "zt"]);
const VALID_ENGINES = new Set(["curl", "node"]);
const TRADING_DAYS_SCRIPT = path.resolve(__dirname, "../utils/generate_trading_days.js");

function printUsage() {
  console.error(
    "Usage: node fetch/fetch_pool.js <dt|qs|zb|zt> [YYYYMMDD] [--days <N>] [--json] [--output <file>] [--print-curl] [--engine <curl|node>]"
  );
}

function formatToday(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
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

async function resolveTradingDate(daysOffset) {
  const endDate = formatToday(0);
  const startDate = formatToday(-(daysOffset + 14));
  const { stdout } = await execFileAsync(
    "node",
    [TRADING_DAYS_SCRIPT, startDate, endDate, "--json"],
    { maxBuffer: 10 * 1024 * 1024 }
  );

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

async function loadTemplate(pool) {
  const templatePath = path.resolve(__dirname, `../curl_${pool}.txt`);
  return fs.readFile(templatePath, "utf8");
}

function patchCurlCommand(template, dateValue) {
  const urlMatch = template.match(/^(curl\s+')([^']+)('.*)$/s);
  if (!urlMatch) {
    throw new Error("Template does not start with a parsable curl URL.");
  }

  const [, prefix, originalUrl, suffix] = urlMatch;
  const url = new URL(originalUrl);
  const timestamp = Date.now().toString();

  url.searchParams.set("date", dateValue);
  if (url.searchParams.has("cb")) {
    url.searchParams.set("cb", `callbackdata${timestamp}`);
  }
  if (url.searchParams.has("_")) {
    url.searchParams.set("_", timestamp);
  }

  return `${prefix}${url.toString()}${suffix}`;
}

function parseCurlTemplate(commandText) {
  const lines = commandText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (line.endsWith("\\") ? line.slice(0, -1).trimEnd() : line));

  const firstLine = lines[0];
  const urlMatch = firstLine?.match(/^curl\s+'([^']+)'$/);
  if (!urlMatch) {
    throw new Error("Patched curl command does not contain a parsable URL.");
  }

  const headers = {};
  for (const line of lines.slice(1)) {
    const headerMatch = line.match(/^-H\s+'([^:]+):\s*(.*)'$/);
    if (headerMatch) {
      const [, name, value] = headerMatch;
      headers[name] = value;
      continue;
    }

    const cookieMatch = line.match(/^-b\s+'(.*)'$/);
    if (cookieMatch) {
      headers.Cookie = cookieMatch[1];
    }
  }

  return {
    url: urlMatch[1],
    headers,
  };
}

function extractJsonString(rawText) {
  const trimmed = rawText.trim();
  const match = trimmed.match(/^[\w$.]+\(([\s\S]*)\);?$/);
  if (!match) {
    throw new Error("Response does not match expected JSONP format.");
  }

  return match[1].trim();
}

async function executeCurl(commandText) {
  const { stdout } = await execFileAsync("bash", ["-lc", commandText], {
    maxBuffer: 10 * 1024 * 1024,
  });

  return stdout;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function executeNodeHttp(commandText) {
  const { url, headers } = parseCurlTemplate(commandText);
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers,
        redirect: "follow",
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      return response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await sleep(attempt * 300);
      }
    }
  }

  const causeMessage =
    lastError && typeof lastError === "object" && "cause" in lastError && lastError.cause
      ? `: ${lastError.cause.message || String(lastError.cause)}`
      : "";
  throw new Error(`Node HTTP request failed${causeMessage}`);
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
  const template = await loadTemplate(pool);
  const commandText = patchCurlCommand(template, dateValue);

  if (printCurl) {
    if (outputFile) {
      await fs.writeFile(outputFile, `${commandText}\n`, "utf8");
      console.log(outputFile);
      return;
    }

    process.stdout.write(`${commandText}\n`);
    return;
  }

  const rawOutput =
    engine === "node" ? await executeNodeHttp(commandText) : await executeCurl(commandText);
  const outputText = outputJson
    ? `${JSON.stringify(JSON.parse(extractJsonString(rawOutput)), null, 2)}\n`
    : rawOutput;

  if (outputFile) {
    await fs.writeFile(outputFile, outputText, "utf8");
    console.log(outputFile);
    return;
  }

  process.stdout.write(outputText);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
