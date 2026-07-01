#!/usr/bin/env node

"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { formatMarketDate, normalizeDate } = require("../src/core/date");
const { getAllMarketStocks } = require("../src/sources/eastmoney/client");

const SUPPORTED_MARKETS = new Set(["hs-a"]);

function printUsage() {
  console.error(
    "Usage: node fetch/fetch_market_stocks.js [--latest|--date YYYYMMDD] [--market hs-a] [--output-dir data/universe] [--page-size N]"
  );
}

function parsePositiveInteger(value, flagName) {
  if (!value || !/^\d+$/.test(value) || Number(value) < 1) {
    throw new Error(`Invalid value for ${flagName}: ${value ?? ""}`);
  }
  return Number(value);
}

function parseArguments(argv) {
  const options = {
    date: null,
    latest: false,
    market: "hs-a",
    outputDir: path.resolve("data/universe"),
    pageSize: 500,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--latest") {
      options.latest = true;
      continue;
    }

    if (arg === "--date") {
      const nextArg = argv[index + 1];
      if (!nextArg) {
        throw new Error("Missing value for --date.");
      }
      options.date = normalizeDate(nextArg);
      index += 1;
      continue;
    }

    if (arg === "--market") {
      const nextArg = argv[index + 1];
      if (!nextArg || !SUPPORTED_MARKETS.has(nextArg)) {
        throw new Error(`Invalid value for --market: ${nextArg ?? ""}`);
      }
      options.market = nextArg;
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

    if (arg === "--page-size") {
      const nextArg = argv[index + 1];
      options.pageSize = parsePositiveInteger(nextArg, "--page-size");
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.date && options.latest) {
    throw new Error("--date and --latest cannot be used together.");
  }

  if (!options.date && !options.latest) {
    options.latest = true;
  }

  if (!SUPPORTED_MARKETS.has(options.market)) {
    throw new Error(`Unsupported market: ${options.market}`);
  }

  return options;
}

function resolveDate(options, now = new Date()) {
  return options.date ?? formatMarketDate(0, now);
}

function isHsAStock(code, marketId) {
  if (marketId === 1) {
    return /^6\d{5}$/.test(code);
  }
  if (marketId === 0) {
    return /^0\d{5}$/.test(code) || /^30[0-2]\d{3}$/.test(code);
  }
  return false;
}

function marketName(marketId) {
  if (marketId === 1) {
    return "sh";
  }
  if (marketId === 0) {
    return "sz";
  }
  return String(marketId ?? "");
}

function boardName(code, marketId) {
  if (marketId === 1 && /^(688|689)/.test(code)) {
    return "star";
  }
  if (marketId === 0 && /^(300|301)/.test(code)) {
    return "chinext";
  }
  return "main";
}

function parseMaybeNumber(value) {
  if (value === null || value === undefined || value === "" || value === "-") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeQuoteAvailable(item) {
  if (!Object.prototype.hasOwnProperty.call(item ?? {}, "f2")) {
    return null;
  }
  return parseMaybeNumber(item.f2) !== null;
}

function normalizeMarketStock(item, market = "hs-a") {
  const code = String(item?.f12 ?? item?.code ?? "").trim();
  const marketId = Number(item?.f13 ?? item?.market_id);
  const name = String(item?.f14 ?? item?.name ?? "").trim();

  if (!/^\d{6}$/.test(code) || !Number.isInteger(marketId) || !name) {
    return null;
  }

  if (market === "hs-a" && !isHsAStock(code, marketId)) {
    return null;
  }

  const quoteAvailable = normalizeQuoteAvailable(item);
  const stock = {
    code,
    name,
    market_id: marketId,
    market: marketName(marketId),
    secid: `${marketId}.${code}`,
    board: boardName(code, marketId),
  };

  if (quoteAvailable !== null) {
    stock.quote_available = quoteAvailable;
    stock.latest_price = parseMaybeNumber(item.f2);
    stock.change_pct = parseMaybeNumber(item.f3);
    stock.quote_timestamp = Number.isFinite(Number(item.f124)) ? Number(item.f124) : null;
  }

  return stock;
}

function extractRows(payload) {
  if (Array.isArray(payload?.data?.diff)) {
    return payload.data.diff;
  }
  if (Array.isArray(payload?.result?.data)) {
    return payload.result.data;
  }
  if (Array.isArray(payload)) {
    return payload;
  }
  return [];
}

function buildStockUniverse({ date, market, payload, generatedAt = new Date().toISOString() }) {
  const stocksByCode = new Map();
  for (const item of extractRows(payload)) {
    const stock = normalizeMarketStock(item, market);
    if (!stock) {
      continue;
    }
    stocksByCode.set(stock.code, stock);
  }

  const stocks = [...stocksByCode.values()].sort((left, right) => left.code.localeCompare(right.code));
  const codes = stocks.map((stock) => stock.code);
  const quoteKnown = stocks.filter((stock) => typeof stock.quote_available === "boolean").length;
  const quoteAvailable = stocks.filter((stock) => stock.quote_available === true).length;
  const quoteUnavailable = stocks.filter((stock) => stock.quote_available === false).length;
  const base = {
    date,
    market,
    source: "eastmoney_clist",
    generated_at: generatedAt,
  };

  return {
    stocksPayload: {
      ...base,
      total_raw: Number(payload?.data?.total ?? extractRows(payload).length),
      total_stocks: stocks.length,
      quote_available: quoteAvailable,
      quote_unavailable: quoteUnavailable,
      quote_unknown: stocks.length - quoteKnown,
      stocks,
    },
    codesPayload: {
      ...base,
      total_codes: codes.length,
      codes,
    },
    summary: {
      ...base,
      status: stocks.length > 0 ? "completed" : "empty",
      total_raw: Number(payload?.data?.total ?? extractRows(payload).length),
      total_stocks: stocks.length,
      total_codes: codes.length,
      quote_available: quoteAvailable,
      quote_unavailable: quoteUnavailable,
      quote_unknown: stocks.length - quoteKnown,
    },
  };
}

async function writeStockUniverse(outputDir, date, universe) {
  const dateDir = path.join(outputDir, date);
  await fs.mkdir(dateDir, { recursive: true });
  await fs.writeFile(
    path.join(dateDir, "stocks.json"),
    `${JSON.stringify(universe.stocksPayload, null, 2)}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(dateDir, "codes.json"),
    `${JSON.stringify(universe.codesPayload, null, 2)}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(dateDir, "summary.json"),
    `${JSON.stringify(universe.summary, null, 2)}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(outputDir, "summary.json"),
    `${JSON.stringify(universe.summary, null, 2)}\n`,
    "utf8"
  );
  return dateDir;
}

async function fetchMarketStocks(options, fetcher = getAllMarketStocks) {
  const date = resolveDate(options);
  const payload = await fetcher(options.market, options.pageSize);
  const universe = buildStockUniverse({ date, market: options.market, payload });
  const outputPath = await writeStockUniverse(options.outputDir, date, universe);
  return {
    outputPath,
    ...universe.summary,
  };
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    printUsage();
    throw error;
  }

  const summary = await fetchMarketStocks(options);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  buildStockUniverse,
  fetchMarketStocks,
  isHsAStock,
  normalizeMarketStock,
  parseArguments,
  resolveDate,
  writeStockUniverse,
};
