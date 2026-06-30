#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const FETCH_KLINE_SCRIPT = path.resolve(__dirname, "./fetch_kline.js");
const VALID_ENGINES = new Set(["auto", "local", "aws"]);
const PERIODS = new Set(["daily", "yearly"]);

function printUsage() {
  console.error(
    "Usage: node fetch/query_pool_klines.js <input_dir|codes.json> [--period <daily|yearly>] [--engine <auto|local|aws>] [--aws-region <r1,r2,...>] [--lambda-name <name>] [--config <file>] [--output-dir <dir>] [--limit <N>] [--force] [--concurrency <N>] [--min-success-rate <0..1>]"
  );
}

function parsePositiveInteger(value, flagName) {
  if (!value || !/^\d+$/.test(value) || Number(value) < 1) {
    throw new Error(`Invalid value for ${flagName}: ${value ?? ""}`);
  }
  return Number(value);
}

function parseSuccessRate(value) {
  const rate = Number(value);
  if (!value || !Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw new Error(`Invalid value for --min-success-rate: ${value ?? ""}`);
  }
  return rate;
}

function defaultConcurrency(engine) {
  return engine === "local" ? 4 : 25;
}

function parseArguments(argv) {
  const options = {
    awsRegions: null,
    concurrency: null,
    configFile: null,
    engine: "auto",
    force: false,
    inputPath: null,
    lambdaName: "kline",
    limit: null,
    minSuccessRate: null,
    outputDir: path.resolve("data/kline"),
    period: "daily",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--period") {
      const nextArg = argv[index + 1];
      if (!nextArg || !PERIODS.has(nextArg)) {
        throw new Error(`Invalid value for --period: ${nextArg ?? ""}`);
      }
      options.period = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--engine") {
      const nextArg = argv[index + 1];
      if (!nextArg || !VALID_ENGINES.has(nextArg)) {
        throw new Error(`Invalid value for --engine: ${nextArg ?? ""}`);
      }
      options.engine = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--aws-region") {
      const nextArg = argv[index + 1];
      if (!nextArg) {
        throw new Error("Missing value for --aws-region.");
      }
      options.awsRegions = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--lambda-name") {
      const nextArg = argv[index + 1];
      if (!nextArg) {
        throw new Error("Missing value for --lambda-name.");
      }
      options.lambdaName = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--config") {
      const nextArg = argv[index + 1];
      if (!nextArg) {
        throw new Error("Missing value for --config.");
      }
      options.configFile = path.resolve(nextArg);
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

    if (arg === "--limit") {
      const nextArg = argv[index + 1];
      options.limit = parsePositiveInteger(nextArg, "--limit");
      index += 1;
      continue;
    }

    if (arg === "--concurrency") {
      const nextArg = argv[index + 1];
      options.concurrency = parsePositiveInteger(nextArg, "--concurrency");
      index += 1;
      continue;
    }

    if (arg === "--min-success-rate") {
      const nextArg = argv[index + 1];
      options.minSuccessRate = parseSuccessRate(nextArg);
      index += 1;
      continue;
    }

    if (arg === "--force") {
      options.force = true;
      continue;
    }

    if (options.inputPath) {
      throw new Error("Only one input_path is supported.");
    }

    options.inputPath = path.resolve(arg);
  }

  if (!options.inputPath) {
    printUsage();
    process.exitCode = 1;
    return null;
  }

  if (options.concurrency === null) {
    options.concurrency = defaultConcurrency(options.engine);
  }

  return options;
}

function uniqueCodes(codes) {
  return [...new Set(codes.filter(Boolean))].sort();
}

async function extractCodesFromPoolDir(dirPath) {
  const codesFile = path.join(dirPath, "codes.json");
  try {
    const raw = await fs.readFile(codesFile, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.codes)) {
      return uniqueCodes(parsed.codes);
    }
  } catch {}

  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const jsonFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && entry.name !== "summary.json" && entry.name !== "codes.json")
    .map((entry) => path.join(dirPath, entry.name))
    .sort();

  const codes = [];
  for (const filePath of jsonFiles) {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    const pool = Array.isArray(parsed?.data?.pool) ? parsed.data.pool : [];
    for (const item of pool) {
      if (item?.c) {
        codes.push(item.c);
      }
    }
  }

  return uniqueCodes(codes);
}

async function loadCodes(inputPath) {
  const stats = await fs.stat(inputPath);
  if (stats.isDirectory()) {
    return extractCodesFromPoolDir(inputPath);
  }

  const raw = await fs.readFile(inputPath, "utf8");

  if (inputPath.endsWith(".json")) {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return uniqueCodes(parsed);
    }
    if (Array.isArray(parsed?.codes)) {
      return uniqueCodes(parsed.codes);
    }
  }

  return uniqueCodes(
    raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
  );
}

function inferSecid(code) {
  if (/^\d+\.[A-Za-z0-9]+$/.test(code)) {
    return code;
  }
  if (/^6\d{5}$/.test(code)) {
    return `1.${code}`;
  }
  if (/^[03]\d{5}$/.test(code)) {
    return `0.${code}`;
  }
  if (/^9\d{5}$/.test(code)) {
    return `0.${code}`;
  }
  throw new Error(`Unable to infer market for code: ${code}`);
}

function extractStockCode(input) {
  if (/^\d+\.[A-Za-z0-9]+$/.test(input)) {
    return input.split(".")[1];
  }
  return input;
}

function inferMarketFromSecid(secid) {
  if (/^\d+\.[A-Za-z0-9]+$/.test(secid)) {
    return Number(secid.split(".")[0]);
  }
  return null;
}

function getOutputPath(outputDir, period, code) {
  const prefix = code.slice(0, 3);
  return path.join(outputDir, period, prefix, `${code}.json`);
}

function getLegacyOutputPath(outputDir, period, code) {
  return path.join(outputDir, period, `${code}.json`);
}

function normalizeKlinePayload(payload, code, secid, period) {
  const klines = Array.isArray(payload?.klines)
    ? payload.klines
    : Array.isArray(payload?.data?.klines)
      ? payload.data.klines
      : [];
  const normalizedCode = payload?.code ?? payload?.data?.code ?? code;
  const market = payload?.market ?? payload?.data?.market ?? inferMarketFromSecid(secid);

  return {
    code: normalizedCode,
    market,
    period,
    klines: [...klines].sort((left, right) => {
      const leftDate = typeof left === "string" ? left.split(",")[0] : "";
      const rightDate = typeof right === "string" ? right.split(",")[0] : "";
      return leftDate.localeCompare(rightDate);
    }),
  };
}

async function fetchSingleKline(secid, options) {
  const args = [FETCH_KLINE_SCRIPT, secid, "--period", options.period, "--engine", options.engine];

  if (options.awsRegions) {
    args.push("--aws-region", options.awsRegions);
  }

  if (options.lambdaName) {
    args.push("--lambda-name", options.lambdaName);
  }

  if (options.configFile) {
    args.push("--config", options.configFile);
  }

  if (Number.isInteger(options.awsRegionStartIndex)) {
    args.push("--aws-region-start-index", String(options.awsRegionStartIndex));
  }

  const { stdout } = await execFileAsync("node", args, {
    maxBuffer: 25 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
}

function incrementCount(counts, key) {
  if (!key) {
    return;
  }
  counts[key] = (counts[key] ?? 0) + 1;
}

function createSummary(options, selectedCodes) {
  return {
    aws_regions: options.awsRegions,
    aws_region_strategy: options.engine === "local" ? "none" : "round_robin_start_index",
    concurrency: options.concurrency,
    engine: options.engine,
    force: options.force,
    input_path: options.inputPath,
    lambda_name: options.lambdaName,
    min_success_rate: options.minSuccessRate,
    period: options.period,
    total_codes: selectedCodes.length,
    success: 0,
    migrated_existing: 0,
    skipped_existing: 0,
    failed: 0,
    success_rate: selectedCodes.length === 0 ? 1 : 0,
    engine_counts: {},
    region_counts: {},
    failure_reasons: [],
    status: "completed",
    files: {},
  };
}

function fetchOptionsForIndex(options, itemIndex) {
  if (options.engine === "local") {
    return options;
  }
  return {
    ...options,
    awsRegionStartIndex: itemIndex,
  };
}

async function processCode(inputCode, options, fetchKline, itemIndex = 0) {
  let secid;
  let code;
  try {
    secid = inferSecid(inputCode);
    code = extractStockCode(inputCode);
  } catch (error) {
    return {
      code: inputCode,
      countKey: "failed",
      file: {
        status: "failed",
        secid: null,
        error: error.message,
      },
    };
  }

  const outputPath = getOutputPath(options.outputDir, options.period, code);
  const legacyOutputPath = getLegacyOutputPath(options.outputDir, options.period, code);

  if (!options.force) {
    try {
      await fs.access(outputPath);
      return {
        code,
        countKey: "skipped_existing",
        file: {
          status: "skipped_existing",
          file: outputPath,
          secid,
        },
      };
    } catch {}

    try {
      const rawLegacy = await fs.readFile(legacyOutputPath, "utf8");
      const legacyPayload = JSON.parse(rawLegacy);
      const normalized = normalizeKlinePayload(legacyPayload, code, secid, options.period);
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
      return {
        code,
        countKey: "migrated_existing",
        file: {
          status: "migrated_existing",
          file: outputPath,
          legacy_file: legacyOutputPath,
          secid,
          points: normalized.klines.length,
        },
      };
    } catch {}
  }

  try {
    const data = await fetchKline(secid, fetchOptionsForIndex(options, itemIndex));
    const normalized = normalizeKlinePayload(data, code, secid, options.period);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
    return {
      code,
      countKey: "success",
      file: {
        engine: data.source_engine ?? options.engine,
        region: data.source_region ?? null,
        status: "success",
        file: outputPath,
        secid,
        points: normalized.klines.length,
      },
    };
  } catch (error) {
    return {
      code,
      countKey: "failed",
      file: {
        status: "failed",
        secid,
        error: error.message,
      },
    };
  }
}

function finalizeSummary(summary, options) {
  summary.success_rate = summary.total_codes === 0 ? 1 : summary.success / summary.total_codes;

  if (summary.failed > 0) {
    summary.failure_reasons.push("failed_items");
  }

  if (options.minSuccessRate !== null && summary.success_rate < options.minSuccessRate) {
    summary.failure_reasons.push("success_rate_below_minimum");
  }

  if (
    options.minSuccessRate !== null &&
    options.engine === "aws" &&
    summary.total_codes > 0 &&
    (summary.engine_counts.aws ?? 0) === 0
  ) {
    summary.failure_reasons.push("aws_success_zero");
  }

  if (summary.failure_reasons.includes("aws_success_zero")) {
    summary.status = "failed_aws_unavailable";
  } else if (summary.failure_reasons.includes("success_rate_below_minimum")) {
    summary.status = "failed_success_rate";
  } else if (summary.failed > 0) {
    summary.status = "completed_with_failures";
  }
}

async function queryPoolKlines(options, fetchKline = fetchSingleKline) {
  const effectiveOptions = {
    awsRegions: options.awsRegions ?? null,
    concurrency: options.concurrency ?? defaultConcurrency(options.engine ?? "auto"),
    configFile: options.configFile ?? null,
    engine: options.engine ?? "auto",
    force: Boolean(options.force),
    inputPath: options.inputPath,
    lambdaName: options.lambdaName ?? "kline",
    limit: options.limit ?? null,
    minSuccessRate: options.minSuccessRate ?? null,
    outputDir: options.outputDir ?? path.resolve("data/kline"),
    period: options.period ?? "daily",
  };
  const codes = await loadCodes(effectiveOptions.inputPath);
  const selectedCodes = effectiveOptions.limit ? codes.slice(0, effectiveOptions.limit) : codes;
  const periodDir = path.join(effectiveOptions.outputDir, effectiveOptions.period);
  await fs.mkdir(periodDir, { recursive: true });

  const summary = createSummary(effectiveOptions, selectedCodes);
  const results = await mapWithConcurrency(selectedCodes, effectiveOptions.concurrency, (inputCode, itemIndex) =>
    processCode(inputCode, effectiveOptions, fetchKline, itemIndex)
  );

  for (const result of results) {
    summary.files[result.code] = result.file;
    summary[result.countKey] += 1;
    if (result.countKey === "success") {
      incrementCount(summary.engine_counts, result.file.engine);
      incrementCount(summary.region_counts, result.file.region);
    }
  }

  finalizeSummary(summary, effectiveOptions);

  const summaryPath = path.join(periodDir, `summary.${effectiveOptions.period}.json`);
  await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  return {
    exitCode: summary.failure_reasons.length > 0 ? 1 : 0,
    summary,
    summaryPath,
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options) {
    return;
  }

  const result = await queryPoolKlines(options);
  console.log(result.summaryPath);

  if (result.exitCode !== 0) {
    process.exitCode = result.exitCode;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  defaultConcurrency,
  parseArguments,
  queryPoolKlines,
};
