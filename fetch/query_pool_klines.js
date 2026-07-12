#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { getKlines, inspectKlinePayload } = require("./check_kline_empty");
const { stageLog, startStageHeartbeat } = require("../src/core/stage_log");
const { classifyProxyError, cooldownMs, DEFAULT_STATE_FILE } = require("../src/proxy/pool");
const { ProxyBatchRuntime } = require("../src/proxy/runtime");

const VALID_ENGINES = new Set(["auto", "local", "aws", "aws-router", "huaweicloud", "proxy-pool"]);
const PERIODS = new Set(["daily", "yearly"]);

function printUsage() {
  console.error(
    "Usage: node fetch/query_pool_klines.js <input_dir|codes.json> [--period <daily|yearly>] [--policy <name> | --engine <engine>] [--refresh-mode <incremental|full>] [--proxy-preflight] [--proxy-min-available <N>] [--proxy-min-success-rate <0..1>] [--concurrency <N|auto>] [--checkpoint-every <N>] [--expected-latest-date <YYYYMMDD|YYYY-MM-DD>] [--freshness-codes <codes.json>]"
  );
}

function parseNonNegativeInteger(value, flagName) {
  if (!value || !/^\d+$/.test(value)) {
    throw new Error(`Invalid value for ${flagName}: ${value ?? ""}`);
  }
  return Number(value);
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

function normalizeExpectedLatestDate(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const digits = String(value).replace(/-/g, "");
  if (!/^\d{8}$/.test(digits)) {
    throw new Error(`Invalid value for --expected-latest-date: ${value}`);
  }
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function defaultConcurrency(engine) {
  return engine === "local" ? 4 : 1;
}

function parseArguments(argv) {
  const options = {
    awsRegions: null,
    batchSize: null,
    concurrency: null,
    checkpointEvery: 50,
    configFile: null,
    engine: "auto",
    force: false,
    huaweiCloudRegionStartIndex: null,
    huaweiCloudRegions: null,
    huaweiCloudTargetsFile: null,
    expectedLatestDate: null,
    freshnessCodes: null,
    freshnessCodesPath: null,
    inputPath: null,
    lambdaName: "kline",
    limit: null,
    minSuccessRate: null,
    offset: 0,
    outputDir: path.resolve("data/kline"),
    period: "daily",
    refreshMode: "incremental",
    policy: null,
    proxyMaxAttempts: 3,
    proxyMinAvailable: 5,
    proxyMinSuccessRate: 0.6,
    proxyPreflight: null,
    proxyPreflightConcurrency: 16,
    proxyPreflightTimeoutMs: 3000,
    proxyPoolUrl: null,
    retryAttempts: 0,
    retryConcurrency: null,
    retryDelayMs: 1000,
    routerRegion: "auto",
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

    if (arg === "--refresh-mode") {
      const nextArg = argv[index + 1];
      if (!nextArg || !["incremental", "full"].includes(nextArg)) throw new Error(`Invalid value for --refresh-mode: ${nextArg ?? ""}`);
      options.refreshMode = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--checkpoint-every") {
      options.checkpointEvery = parsePositiveInteger(argv[index + 1], "--checkpoint-every");
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

    if (arg === "--policy") {
      const nextArg = argv[index + 1];
      if (!nextArg) throw new Error("Missing value for --policy.");
      options.policy = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--proxy-pool-url") {
      const nextArg = argv[index + 1];
      if (!nextArg) {
        throw new Error("Missing value for --proxy-pool-url.");
      }
      options.proxyPoolUrl = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--proxy-max-attempts") {
      const nextArg = argv[index + 1];
      options.proxyMaxAttempts = parsePositiveInteger(nextArg, "--proxy-max-attempts");
      index += 1;
      continue;
    }

    if (arg === "--proxy-preflight") {
      options.proxyPreflight = true;
      continue;
    }

    if (arg === "--no-proxy-preflight") {
      options.proxyPreflight = false;
      continue;
    }

    if (arg === "--proxy-min-available") {
      options.proxyMinAvailable = parsePositiveInteger(argv[index + 1], "--proxy-min-available");
      index += 1;
      continue;
    }

    if (arg === "--proxy-min-success-rate") {
      options.proxyMinSuccessRate = parseSuccessRate(argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--proxy-preflight-concurrency") {
      options.proxyPreflightConcurrency = parsePositiveInteger(argv[index + 1], "--proxy-preflight-concurrency");
      index += 1;
      continue;
    }

    if (arg === "--proxy-preflight-timeout-ms") {
      options.proxyPreflightTimeoutMs = parsePositiveInteger(argv[index + 1], "--proxy-preflight-timeout-ms");
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

    if (arg === "--huaweicloud-region") {
      const nextArg = argv[index + 1];
      if (!nextArg) {
        throw new Error("Missing value for --huaweicloud-region.");
      }
      options.huaweiCloudRegions = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--router-region") {
      const nextArg = argv[index + 1];
      if (!nextArg) {
        throw new Error("Missing value for --router-region.");
      }
      options.routerRegion = nextArg.trim() || "auto";
      index += 1;
      continue;
    }

    if (arg === "--huaweicloud-region-start-index") {
      const nextArg = argv[index + 1];
      options.huaweiCloudRegionStartIndex = parseNonNegativeInteger(nextArg, "--huaweicloud-region-start-index");
      index += 1;
      continue;
    }

    if (arg === "--huaweicloud-targets") {
      const nextArg = argv[index + 1];
      if (!nextArg) {
        throw new Error("Missing value for --huaweicloud-targets.");
      }
      options.huaweiCloudTargetsFile = path.resolve(nextArg);
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

    if (arg === "--batch-size") {
      const nextArg = argv[index + 1];
      options.batchSize = parsePositiveInteger(nextArg, "--batch-size");
      index += 1;
      continue;
    }

    if (arg === "--offset") {
      const nextArg = argv[index + 1];
      options.offset = parseNonNegativeInteger(nextArg, "--offset");
      index += 1;
      continue;
    }

    if (arg === "--concurrency") {
      const nextArg = argv[index + 1];
      options.concurrency = nextArg === "auto" ? null : parsePositiveInteger(nextArg, "--concurrency");
      index += 1;
      continue;
    }

    if (arg === "--retry-attempts") {
      const nextArg = argv[index + 1];
      options.retryAttempts = parseNonNegativeInteger(nextArg, "--retry-attempts");
      index += 1;
      continue;
    }

    if (arg === "--retry-delay-ms") {
      const nextArg = argv[index + 1];
      options.retryDelayMs = parseNonNegativeInteger(nextArg, "--retry-delay-ms");
      index += 1;
      continue;
    }

    if (arg === "--retry-concurrency") {
      const nextArg = argv[index + 1];
      options.retryConcurrency = parsePositiveInteger(nextArg, "--retry-concurrency");
      index += 1;
      continue;
    }

    if (arg === "--min-success-rate") {
      const nextArg = argv[index + 1];
      options.minSuccessRate = parseSuccessRate(nextArg);
      index += 1;
      continue;
    }

    if (arg === "--expected-latest-date") {
      const nextArg = argv[index + 1];
      options.expectedLatestDate = normalizeExpectedLatestDate(nextArg);
      index += 1;
      continue;
    }

    if (arg === "--freshness-codes") {
      const nextArg = argv[index + 1];
      if (!nextArg) {
        throw new Error("Missing value for --freshness-codes.");
      }
      options.freshnessCodesPath = path.resolve(nextArg);
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

  if (options.concurrency === null && options.policy !== "proxy-only") {
    options.concurrency = defaultConcurrency(options.engine);
  }
  if (options.retryConcurrency === null) {
    options.retryConcurrency = 1;
  }

  if (options.policy && options.engine !== "auto") throw new Error("--policy and --engine cannot be used together.");
  return options;
}

function uniqueCodes(codes) {
  return [...new Set((codes ?? []).map((code) => String(code).trim()).filter(Boolean))].sort();
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

async function loadFreshnessCodes(options) {
  if (!options.expectedLatestDate) {
    return null;
  }

  if (options.freshnessCodes instanceof Set) {
    return new Set(uniqueCodes([...options.freshnessCodes]));
  }

  if (Array.isArray(options.freshnessCodes)) {
    return new Set(uniqueCodes(options.freshnessCodes));
  }

  if (!options.freshnessCodesPath) {
    return null;
  }

  return new Set(await loadCodes(options.freshnessCodesPath));
}

function latestKlineDate(payload) {
  const klines = getKlines(payload);
  if (!Array.isArray(klines.value) || klines.value.length === 0) {
    return null;
  }

  for (let index = klines.value.length - 1; index >= 0; index -= 1) {
    const row = klines.value[index];
    if (typeof row !== "string") {
      continue;
    }
    const date = row.split(",")[0];
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return date;
    }
  }

  return null;
}

function freshnessRequired(options, code) {
  return (
    Boolean(options.expectedLatestDate) &&
    (options.freshnessCodes === null || options.freshnessCodes.has(code))
  );
}

function inspectFreshness(payload, code, options) {
  if (!freshnessRequired(options, code)) {
    return null;
  }

  const latestDate = latestKlineDate(payload);
  if (!latestDate || latestDate < options.expectedLatestDate) {
    return {
      issue: "stale_kline",
      latestDate,
      expectedLatestDate: options.expectedLatestDate,
    };
  }

  return null;
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

async function hasShardedOutput(outputDir, period, code, options) {
  try {
    const inspected = await inspectExistingKline(getOutputPath(outputDir, period, code));
    return inspected.issue === null && inspectFreshness(inspected.payload, code, options) === null;
  } catch {
    return false;
  }
}

async function codeNeedsProcessing(inputCode, options) {
  if (options.force) {
    return true;
  }

  try {
    const code = extractStockCode(inputCode);
    return !(await hasShardedOutput(options.outputDir, options.period, code, options));
  } catch {
    return true;
  }
}

async function selectCodes(codes, options) {
  let candidates = codes;
  let selectionMode = "all";

  if (options.batchSize && !options.limit && !options.force) {
    candidates = [];
    for (const code of codes) {
      if (await codeNeedsProcessing(code, options)) {
        candidates.push(code);
      }
    }
    selectionMode = "next_missing";
  }

  const offsetCodes = candidates.slice(options.offset);
  const size = options.limit ?? options.batchSize ?? null;
  const selectedCodes = size ? offsetCodes.slice(0, size) : offsetCodes;

  return {
    availableCodes: codes.length,
    candidateCodes: candidates.length,
    selectedCodes,
    selectionMode,
  };
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

async function readMergeBase(outputPath, legacyOutputPath) {
  for (const file of [outputPath, legacyOutputPath]) {
    try {
      const payload = JSON.parse(await fs.readFile(file, "utf8"));
      if (!inspectKlinePayload(payload)) return payload;
    } catch {}
  }
  return null;
}

function calculateIncrementalLimit(payload, period, expectedLatestDate, refreshMode) {
  if (refreshMode === "full" || !payload || !expectedLatestDate) return 10000;
  const latestDate = latestKlineDate(payload);
  if (!latestDate) return 10000;
  if (period === "yearly") {
    return Math.max(2, Number(expectedLatestDate.slice(0, 4)) - Number(latestDate.slice(0, 4)) + 2);
  }
  const calendarDays = Math.max(0, Math.ceil((Date.parse(expectedLatestDate) - Date.parse(latestDate)) / 86_400_000));
  return Math.min(10000, Math.max(20, Math.ceil(calendarDays * 1.5) + 10));
}

function mergeKlinePayload(basePayload, fetchedPayload, code, secid, period) {
  const fetched = normalizeKlinePayload(fetchedPayload, code, secid, period);
  if (!basePayload) return fetched;
  const base = normalizeKlinePayload(basePayload, code, secid, period);
  const rows = new Map();
  for (const row of [...base.klines, ...fetched.klines]) {
    if (typeof row === "string") rows.set(row.split(",")[0], row);
  }
  return { ...fetched, klines: [...rows.values()].sort((left, right) => left.split(",")[0].localeCompare(right.split(",")[0])) };
}

async function fetchSingleKline(secid, options) {
  const args = [secid, "--period", options.period];
  if (options.policy) args.push("--policy", options.policy);
  else args.push("--engine", options.engine);

  if (options.awsRegions) {
    args.push("--aws-region", options.awsRegions);
  }

  if (options.routerRegion) {
    args.push("--router-region", options.routerRegion);
  }

  if (options.proxyPoolUrl) {
    args.push("--proxy-pool-url", options.proxyPoolUrl);
  }

  if (options.proxyMaxAttempts) {
    args.push("--proxy-max-attempts", String(options.proxyMaxAttempts));
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

  if (options.huaweiCloudRegions) {
    args.push("--huaweicloud-region", options.huaweiCloudRegions);
  }

  if (options.huaweiCloudTargetsFile) {
    args.push("--huaweicloud-targets", options.huaweiCloudTargetsFile);
  }

  if (Number.isInteger(options.huaweiCloudRegionStartIndex)) {
    args.push("--huaweicloud-region-start-index", String(options.huaweiCloudRegionStartIndex));
  }

  const { applyConfigDefaults, parseArguments, resolveKline } = require("./fetch_kline");
  const parsed = parseArguments(args);
  const resolved = await applyConfigDefaults(parsed);
  resolved.klineLimit = options.klineLimit ?? resolved.klineLimit;
  resolved.proxyRuntime = options.proxyRuntime;
  return resolveKline(resolved);
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

async function mapWithAdaptiveConcurrency(items, initialConcurrency, maxConcurrency, mapper, history) {
  const results = [];
  let concurrency = initialConcurrency;
  for (let offset = 0; offset < items.length;) {
    const batch = items.slice(offset, offset + concurrency);
    const batchResults = await Promise.all(batch.map((item, index) => mapper(item, offset + index)));
    results.push(...batchResults);
    const successes = batchResults.filter((result) => result.countKey !== "failed").length;
    const successRate = batchResults.length === 0 ? 1 : successes / batchResults.length;
    history.push({ offset, concurrency, success_rate: successRate });
    if (successRate >= 0.8) concurrency = Math.min(maxConcurrency, concurrency + 1);
    else if (successRate < 0.5) concurrency = Math.max(1, Math.floor(concurrency / 2));
    offset += batch.length;
  }
  return results;
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function incrementCount(counts, key) {
  if (!key) {
    return;
  }
  counts[key] = (counts[key] ?? 0) + 1;
}

function percentile(sortedValues, percentileValue) {
  if (!Array.isArray(sortedValues) || sortedValues.length === 0) {
    return null;
  }
  const index = Math.ceil(sortedValues.length * percentileValue) - 1;
  return sortedValues[Math.max(0, Math.min(index, sortedValues.length - 1))];
}

function classifyFailure(error) {
  const message = String(error?.message ?? error ?? "");
  if (/All proxy-pool attempts failed|ProxyPool returned no valid CN proxy candidates|ProxyPool API returned HTTP/i.test(message)) {
    return "transient_network";
  }
  if (/blank_klines/i.test(message)) {
    return "blank_klines";
  }
  if (/empty_klines/i.test(message)) {
    return "empty_klines";
  }
  if (/stale_kline/i.test(message)) {
    return "stale_kline";
  }
  if (/Unable to infer (market|secid)|Invalid/.test(message)) {
    return "invalid_code";
  }
  if (/statusCode 429|Too Many Requests|rate.?limit/i.test(message)) {
    return "rate_limited";
  }
  if (
    /Lambda returned statusCode 5\d\d|aws-router returned statusCode 5\d\d|FunctionGraph returned statusCode 5\d\d|HTTP 5\d\d|UND_ERR_SOCKET|SocketError|socket hang up|fetch failed|ETIMEDOUT|ECONNRESET|EAI_AGAIN|ENOTFOUND|ECONNREFUSED|timeout/i.test(message)
  ) {
    return "transient_network";
  }
  return "unknown";
}

function isRetriableFailure(errorClass) {
  return ["rate_limited", "transient_network"].includes(errorClass);
}

function routerRegionStrategy(engine, routerRegion) {
  if (engine !== "aws-router") {
    return "none";
  }
  const region = String(routerRegion ?? "auto").trim() || "auto";
  if (region === "auto") {
    return "router_auto";
  }
  if (region === "all") {
    return "router_all";
  }
  if (region.includes(",")) {
    return "ordered_fallback";
  }
  return "single_region";
}

function createSummary(options, selection) {
  return {
    aws_regions: options.awsRegions,
    aws_region_strategy: options.engine === "local"
      ? "none"
      : options.engine === "aws-router"
        ? "router_auto"
        : options.engine === "huaweicloud"
          ? "none"
          : "round_robin_start_index",
    available_codes: selection.availableCodes,
    batch_size: options.batchSize,
    candidate_codes: selection.candidateCodes,
    concurrency: options.concurrency,
    checkpoint_every: options.checkpointEvery,
    engine: options.engine,
    policy: options.policy,
    expected_latest_date: options.expectedLatestDate,
    force: options.force,
    freshness_codes: options.freshnessCodes ? options.freshnessCodes.size : null,
    freshness_codes_path: options.freshnessCodesPath,
    huaweicloud_regions: options.huaweiCloudRegions,
    huaweicloud_region_strategy: options.engine === "huaweicloud" || options.engine === "auto"
      ? "round_robin_start_index"
      : "none",
    input_path: options.inputPath,
    lambda_name: options.lambdaName,
    min_success_rate: options.minSuccessRate,
    offset: options.offset,
    period: options.period,
    refresh_mode: options.refreshMode,
    retry_attempts: options.retryAttempts,
    retry_concurrency: options.retryConcurrency,
    retry_delay_ms: options.retryDelayMs,
    proxy_max_attempts: options.proxyMaxAttempts,
    proxy_pool_url: options.proxyPoolUrl ? "configured" : null,
    proxy_attempts: 0,
    proxy_success: 0,
    proxy_fallback: 0,
    proxy_error_counts: {},
    router_region: options.routerRegion,
    router_region_strategy: routerRegionStrategy(options.engine, options.routerRegion),
    selection_mode: selection.selectionMode,
    total_codes: selection.selectedCodes.length,
    success: 0,
    migrated_existing: 0,
    skipped_existing: 0,
    failed: 0,
    initial_failed: 0,
    retried: 0,
    retry_success: 0,
    retry_failed: 0,
    success_rate: selection.selectedCodes.length === 0 ? 1 : 0,
    attempts_by_code: {},
    engine_counts: {},
    incremental_fetches: 0,
    full_fetches: 0,
    fetched_points: 0,
    duration_ms_by_code: {},
    avg_duration_ms: null,
    p50_duration_ms: null,
    p95_duration_ms: null,
    failure_reason_counts: {},
    region_counts: {},
    retriable_failure_counts: {},
    failure_reasons: [],
    status: "completed",
    files: {},
  };
}

function fetchOptionsForIndex(options, itemIndex) {
  if (options.engine === "local" || options.engine === "aws-router") {
    return options;
  }
  const huaweiCloudStartIndex = Number.isInteger(options.huaweiCloudRegionStartIndex)
    ? options.huaweiCloudRegionStartIndex
    : 0;
  return {
    ...options,
    awsRegionStartIndex: itemIndex,
    huaweiCloudRegionStartIndex: huaweiCloudStartIndex + itemIndex,
  };
}

async function inspectExistingKline(filePath) {
  let raw;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw error;
    }
    return {
      issue: "read_error",
      error: error.message,
      payload: null,
    };
  }

  if (raw.trim() === "") {
    return {
      issue: "empty_file",
      error: "kline file is empty",
      payload: null,
    };
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    return {
      issue: "invalid_json",
      error: error.message,
      payload: null,
    };
  }

  const issue = inspectKlinePayload(payload);
  return {
    issue,
    error: issue ? `existing kline payload is invalid: ${issue}` : null,
    payload,
  };
}

function createFailureResult(code, secid, error, errorClass, extra = {}) {
  return {
    code,
    countKey: "failed",
    file: {
      status: "failed",
      secid,
      error,
      error_class: errorClass,
      retriable: isRetriableFailure(errorClass),
      ...extra,
    },
  };
}

async function removeInvalidKlineFile(filePath) {
  await fs.rm(filePath, { force: true });
}

async function existingShardedResult(outputPath, code, secid, options) {
  let inspected;
  try {
    inspected = await inspectExistingKline(outputPath);
  } catch {
    return null;
  }

  if (inspected.issue) {
    await removeInvalidKlineFile(outputPath);
    return null;
  }

  if (options.force) {
    return null;
  }

  const freshness = inspectFreshness(inspected.payload, code, options);
  if (freshness) {
    return null;
  }

  return {
    code,
    countKey: "skipped_existing",
    file: {
      status: "skipped_existing",
      file: outputPath,
      secid,
    },
  };
}

async function migratedLegacyResult(legacyOutputPath, outputPath, code, secid, options) {
  let inspected;
  try {
    inspected = await inspectExistingKline(legacyOutputPath);
  } catch {
    return null;
  }

  if (inspected.issue) {
    await removeInvalidKlineFile(legacyOutputPath);
    return null;
  }

  const normalized = normalizeKlinePayload(inspected.payload, code, secid, options.period);
  const freshness = inspectFreshness(normalized, code, options);
  if (freshness) {
    return null;
  }

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
}

function validateNormalizedKline(normalized, code, secid, options) {
  const issue = inspectKlinePayload(normalized);
  if (!issue) {
    const freshness = inspectFreshness(normalized, code, options);
    if (!freshness) {
      return null;
    }

    return createFailureResult(
      code,
      secid,
      `${options.period} kline latest date ${freshness.latestDate ?? "none"} is before expected ${freshness.expectedLatestDate}`,
      freshness.issue,
      {
        deferred: true,
        expected_latest_date: freshness.expectedLatestDate,
        latest_date: freshness.latestDate,
      }
    );
  }

  return createFailureResult(
    code,
    secid,
    `kline payload is invalid: ${issue}`,
    issue,
    { deferred: true }
  );
}

function isFallbackEligibleFailureClass(errorClass) {
  return [
    "empty_klines",
    "blank_klines",
    "stale_kline",
    "rate_limited",
    "transient_network",
  ].includes(errorClass);
}

function canFallbackEngine(engine) {
  return ["auto", "aws", "aws-router", "huaweicloud", "proxy-pool"].includes(engine);
}

function shouldFallbackToLocal(failure, options) {
  if (!failure || options.policy || !canFallbackEngine(options.engine)) {
    return false;
  }
  return isFallbackEligibleFailureClass(failure.file?.error_class);
}

async function processCode(inputCode, options, fetchKline, itemIndex = 0) {
  let secid;
  let code;
  try {
    secid = inferSecid(inputCode);
    code = extractStockCode(inputCode);
  } catch (error) {
    const errorClass = classifyFailure(error);
    return createFailureResult(inputCode, null, error.message, errorClass);
  }

  const outputPath = getOutputPath(options.outputDir, options.period, code);
  const legacyOutputPath = getLegacyOutputPath(options.outputDir, options.period, code);

  const existingResult = await existingShardedResult(outputPath, code, secid, options);
  if (existingResult) {
    return existingResult;
  }

  if (!options.force) {
    const migratedResult = await migratedLegacyResult(
      legacyOutputPath,
      outputPath,
      code,
      secid,
      options
    );
    if (migratedResult) {
      return migratedResult;
    }
  }

  let data;
  let normalized;
  let validationFailure;
  let fallbackFrom = null;
  const mergeBase = options.refreshMode === "incremental" ? await readMergeBase(outputPath, legacyOutputPath) : null;
  const klineLimit = calculateIncrementalLimit(mergeBase, options.period, options.expectedLatestDate, options.refreshMode);

  try {
    data = await fetchKline(secid, { ...fetchOptionsForIndex(options, itemIndex), klineLimit });
    normalized = mergeKlinePayload(mergeBase, data, code, secid, options.period);
    validationFailure = validateNormalizedKline(normalized, code, secid, options);
  } catch (error) {
    const errorClass = classifyFailure(error);
    validationFailure = createFailureResult(
      code,
      secid,
      error.message,
      errorClass,
      isFallbackEligibleFailureClass(errorClass) ? { deferred: true } : {}
    );
    if (!shouldFallbackToLocal(validationFailure, options)) {
      return validationFailure;
    }
  }

  if (shouldFallbackToLocal(validationFailure, options)) {
    try {
      stageLog("start", "kline_local_fallback", {
        code,
        secid,
        period: options.period,
        from_engine: options.engine,
        error_class: validationFailure.file?.error_class,
      });
      const localData = await fetchKline(secid, { ...options, engine: "local" });
      const localNormalized = normalizeKlinePayload(localData, code, secid, options.period);
      const localFailure = validateNormalizedKline(localNormalized, code, secid, options);
      if (!localFailure) {
        fallbackFrom = options.engine;
        data = localData;
        normalized = localNormalized;
        validationFailure = null;
        stageLog("end", "kline_local_fallback", {
          code,
          secid,
          period: options.period,
          from_engine: options.engine,
          status: "success",
        });
      } else {
        validationFailure.file.fallback_error = localFailure.file.error;
        validationFailure.file.fallback_error_class = localFailure.file.error_class;
        stageLog("error", "kline_local_fallback", {
          code,
          secid,
          period: options.period,
          from_engine: options.engine,
          error_class: localFailure.file.error_class,
          error: localFailure.file.error,
        });
      }
    } catch (fallbackError) {
      validationFailure.file.fallback_error = fallbackError.message;
      validationFailure.file.fallback_error_class = classifyFailure(fallbackError);
      stageLog("error", "kline_local_fallback", {
        code,
        secid,
        period: options.period,
        from_engine: options.engine,
        error_class: validationFailure.file.fallback_error_class,
        error: fallbackError.message,
      });
    }
  }

  if (validationFailure) {
    return validationFailure;
  }

  try {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    const tempOutputPath = `${outputPath}.${process.pid}.tmp`;
    await fs.writeFile(tempOutputPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
    await fs.rename(tempOutputPath, outputPath);
    if (legacyOutputPath !== outputPath) await fs.rm(legacyOutputPath, { force: true });
    return {
      code,
      countKey: "success",
      file: {
        engine: data.source_engine ?? options.engine,
        policy: data.source_policy ?? options.policy ?? null,
        region: data.source_region ?? null,
        router_duration_ms: Number.isFinite(data.router_duration_ms) ? data.router_duration_ms : null,
        target_duration_ms: Number.isFinite(data.target_duration_ms) ? data.target_duration_ms : null,
        eastmoney_duration_ms: Number.isFinite(data.eastmoney_duration_ms) ? data.eastmoney_duration_ms : null,
        total_duration_ms: Number.isFinite(data.total_duration_ms) ? data.total_duration_ms : null,
        fallback_count: Number.isFinite(data.fallback_count) ? data.fallback_count : null,
        fallback_from: fallbackFrom,
        proxy_attempts: Number.isFinite(data.proxy_attempts) ? data.proxy_attempts : null,
        proxy_id: typeof data.proxy_id === "string" ? data.proxy_id : null,
        proxy_error_counts: data.proxy_error_counts && typeof data.proxy_error_counts === "object"
          ? data.proxy_error_counts
          : null,
        attempted_regions: Array.isArray(data.attempted_regions) ? data.attempted_regions : null,
        status: "success",
        file: outputPath,
        secid,
        points: normalized.klines.length,
        fetched_points: normalizeKlinePayload(data, code, secid, options.period).klines.length,
        requested_kline_limit: klineLimit,
      },
    };
  } catch (error) {
    const errorClass = classifyFailure(error);
    return createFailureResult(code, secid, error.message, errorClass);
  }
}

function addAttempt(summary, result, attempt) {
  summary.attempts_by_code[result.code] = (summary.attempts_by_code[result.code] ?? 0) + 1;
  result.file.attempts = summary.attempts_by_code[result.code];
  result.file.last_attempt = attempt;
  if (result.countKey === "failed" && result.file.retriable) {
    incrementCount(summary.retriable_failure_counts, result.file.error_class);
  }
}

function summarizeFinalResults(summary, results) {
  summary.success = 0;
  summary.migrated_existing = 0;
  summary.skipped_existing = 0;
  summary.failed = 0;
  summary.engine_counts = {};
  summary.incremental_fetches = 0;
  summary.full_fetches = 0;
  summary.fetched_points = 0;
  summary.region_counts = {};
  summary.duration_ms_by_code = {};
  summary.avg_duration_ms = null;
  summary.p50_duration_ms = null;
  summary.p95_duration_ms = null;
  summary.failure_reason_counts = {};
  summary.proxy_attempts = 0;
  summary.proxy_success = 0;
  summary.proxy_fallback = 0;
  summary.proxy_error_counts = {};
  summary.files = {};

  for (const result of results) {
    summary.files[result.code] = result.file;
    summary[result.countKey] += 1;
    if (result.countKey === "success") {
      summary.fetched_points += Number(result.file.fetched_points ?? 0);
      if (Number(result.file.requested_kline_limit) < 10000) summary.incremental_fetches += 1;
      else summary.full_fetches += 1;
      incrementCount(summary.engine_counts, result.file.engine);
      incrementCount(summary.region_counts, result.file.region);
      if (Number.isFinite(result.file.total_duration_ms)) {
        summary.duration_ms_by_code[result.code] = result.file.total_duration_ms;
      }
      if (result.file.engine === "proxy-pool") {
        summary.proxy_success += 1;
        summary.proxy_attempts += Number(result.file.proxy_attempts ?? 0);
        for (const [errorClass, count] of Object.entries(result.file.proxy_error_counts ?? {})) {
          summary.proxy_error_counts[errorClass] = (summary.proxy_error_counts[errorClass] ?? 0) + Number(count);
        }
      }
      if (result.file.fallback_from === "proxy-pool") {
        summary.proxy_fallback += 1;
      }
    }
    if (result.countKey === "failed") {
      incrementCount(summary.failure_reason_counts, result.file.error_class ?? "unknown");
    }
  }

  const durations = Object.values(summary.duration_ms_by_code).sort((left, right) => left - right);
  if (durations.length > 0) {
    summary.avg_duration_ms = durations.reduce((total, value) => total + value, 0) / durations.length;
    summary.p50_duration_ms = percentile(durations, 0.5);
    summary.p95_duration_ms = percentile(durations, 0.95);
  }
}

function finalizeSummary(summary, options) {
  const completed = summary.success + summary.migrated_existing + summary.skipped_existing;
  summary.success_rate = summary.total_codes === 0 ? 1 : completed / summary.total_codes;

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
    summary.failed > 0 &&
    summary.success === 0 &&
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

async function runEntriesWithStage(entries, {
  attempt,
  concurrency,
  fetchKline,
  itemIndexForEntry,
  options,
  retry = false,
}) {
  const batchStage = retry ? "kline_retry_batch" : "kline_initial_batch";
  const progressStage = retry ? "kline_retry_progress" : "kline_batch_progress";
  const inFlight = new Map();
  let completed = 0;
  const total = entries.length;
  stageLog("start", batchStage, {
    attempt,
    concurrency,
    engine: options.engine,
    policy: options.policy,
    period: options.period,
    total,
  });
  const stopHeartbeat = startStageHeartbeat(batchStage, () => ({
    attempt,
    completed,
    in_flight: [...inFlight.values()],
    total,
  }));

  try {
    const mapper = async (entry, mapperIndex) => {
      const inputCode = entry.inputCode;
      const code = extractStockCode(inputCode);
      const itemIndex = itemIndexForEntry(entry, mapperIndex);
      const startedAt = Date.now();
      inFlight.set(code, {
        code,
        input_code: inputCode,
        item_index: itemIndex,
      });
      stageLog("start", "kline_code", {
        attempt,
        code,
        engine: options.engine,
        input_code: inputCode,
        item_index: itemIndex,
        period: options.period,
      });
      try {
        const result = await processCode(inputCode, options, fetchKline, itemIndex);
        completed += 1;
        if (options.checkpointPath && completed % options.checkpointEvery === 0) {
          const checkpoint = { attempt, completed, total, updated_at: new Date().toISOString() };
          const temp = `${options.checkpointPath}.${process.pid}.tmp`;
          await fs.writeFile(temp, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
          await fs.rename(temp, options.checkpointPath);
        }
        stageLog("end", "kline_code", {
          attempt,
          code: result.code ?? code,
          duration_ms: Date.now() - startedAt,
          error_class: result.file?.error_class ?? null,
          item_index: itemIndex,
          status: result.file?.status ?? null,
        });
        if (completed % 10 === 0 || completed === total) {
          stageLog("progress", progressStage, {
            attempt,
            completed,
            in_flight: [...inFlight.values()],
            last_code: result.code ?? code,
            total,
          });
        }
        return result;
      } catch (error) {
        completed += 1;
        stageLog("error", "kline_code", {
          attempt,
          code,
          duration_ms: Date.now() - startedAt,
          error: error?.message ?? String(error),
          item_index: itemIndex,
        });
        throw error;
      } finally {
        inFlight.delete(code);
      }
    };
    const results = options.adaptiveConcurrency
      ? await mapWithAdaptiveConcurrency(entries, concurrency, options.maxAdaptiveConcurrency, mapper, options.concurrencyHistory)
      : await mapWithConcurrency(entries, concurrency, mapper);
    stageLog("end", batchStage, {
      attempt,
      completed,
      total,
    });
    return results;
  } finally {
    stopHeartbeat();
  }
}

async function queryPoolKlines(options, fetchKline = fetchSingleKline) {
  const effectiveOptions = {
    awsRegions: options.awsRegions ?? null,
    batchSize: options.batchSize ?? null,
    checkpointEvery: options.checkpointEvery ?? 50,
    concurrencyHistory: [],
    concurrency: options.concurrency ?? defaultConcurrency(options.engine ?? "auto"),
    configFile: options.configFile ?? null,
    engine: options.engine ?? "auto",
    expectedLatestDate: normalizeExpectedLatestDate(options.expectedLatestDate ?? null),
    force: Boolean(options.force),
    freshnessCodes: null,
    freshnessCodesPath: options.freshnessCodesPath ?? null,
    huaweiCloudRegionStartIndex: options.huaweiCloudRegionStartIndex ?? null,
    huaweiCloudRegions: options.huaweiCloudRegions ?? null,
    huaweiCloudTargetsFile: options.huaweiCloudTargetsFile ?? null,
    inputPath: options.inputPath,
    lambdaName: options.lambdaName ?? "kline",
    limit: options.limit ?? null,
    minSuccessRate: options.minSuccessRate ?? null,
    offset: options.offset ?? 0,
    outputDir: options.outputDir ?? path.resolve("data/kline"),
    period: options.period ?? "daily",
    refreshMode: options.refreshMode ?? "incremental",
    policy: options.policy ?? null,
    proxyMaxAttempts: options.proxyMaxAttempts ?? 3,
    proxyMinAvailable: options.proxyMinAvailable ?? 5,
    proxyMinSuccessRate: options.proxyMinSuccessRate ?? 0.6,
    proxyPreflight: options.proxyPreflight ?? options.policy === "proxy-only",
    proxyPreflightConcurrency: options.proxyPreflightConcurrency ?? 16,
    proxyPreflightTimeoutMs: options.proxyPreflightTimeoutMs ?? 3000,
    proxyPoolUrl: options.proxyPoolUrl ?? null,
    retryAttempts: options.retryAttempts ?? 0,
    retryConcurrency: options.retryConcurrency ?? 1,
    retryDelayMs: options.retryDelayMs ?? 1000,
    routerRegion: options.routerRegion ?? "auto",
  };
  let proxyRuntime = null;
  if (effectiveOptions.proxyPreflight && fetchKline === fetchSingleKline) {
    proxyRuntime = new ProxyBatchRuntime({
      classifyError: classifyProxyError,
      cooldownForError: cooldownMs,
      stateFile: process.env.X_PROXY_POOL_STATE_FILE ?? DEFAULT_STATE_FILE,
    });
    try {
      effectiveOptions.proxy_preflight = await proxyRuntime.prepare({
        concurrency: effectiveOptions.proxyPreflightConcurrency,
        minAvailable: effectiveOptions.proxyMinAvailable,
        minSuccessRate: effectiveOptions.proxyMinSuccessRate,
        timeoutMs: effectiveOptions.proxyPreflightTimeoutMs,
      });
    } catch (error) {
      await proxyRuntime.close();
      throw error;
    }
    effectiveOptions.proxyRuntime = proxyRuntime;
    if (options.concurrency === null || options.concurrency === undefined) {
      effectiveOptions.concurrency = Math.max(1, Math.min(16, proxyRuntime.available.length));
      effectiveOptions.adaptiveConcurrency = true;
      effectiveOptions.maxAdaptiveConcurrency = Math.min(16, proxyRuntime.available.length);
    }
  }
  effectiveOptions.freshnessCodes = await loadFreshnessCodes({
    ...options,
    expectedLatestDate: effectiveOptions.expectedLatestDate,
    freshnessCodesPath: effectiveOptions.freshnessCodesPath,
    period: effectiveOptions.period,
  });
  stageLog("start", "kline_load_codes", {
    input_path: effectiveOptions.inputPath,
    period: effectiveOptions.period,
  });
  const codes = await loadCodes(effectiveOptions.inputPath);
  stageLog("end", "kline_load_codes", {
    available_codes: codes.length,
    input_path: effectiveOptions.inputPath,
  });
  stageLog("start", "kline_select_codes", {
    batch_size: effectiveOptions.batchSize,
    force: effectiveOptions.force,
    limit: effectiveOptions.limit,
    offset: effectiveOptions.offset,
  });
  const selection = await selectCodes(codes, effectiveOptions);
  stageLog("end", "kline_select_codes", {
    available_codes: selection.availableCodes,
    candidate_codes: selection.candidateCodes,
    selected_codes: selection.selectedCodes.length,
    selection_mode: selection.selectionMode,
  });
  const selectedCodes = selection.selectedCodes;
  const periodDir = path.join(effectiveOptions.outputDir, effectiveOptions.period);
  await fs.mkdir(periodDir, { recursive: true });
  const checkpointId = crypto.createHash("sha256")
    .update(`${effectiveOptions.inputPath}:${effectiveOptions.outputDir}:${effectiveOptions.period}`)
    .digest("hex").slice(0, 12);
  effectiveOptions.checkpointPath = path.resolve(__dirname, `../var/kline-sync/${checkpointId}.json`);
  await fs.mkdir(path.dirname(effectiveOptions.checkpointPath), { recursive: true });

  const summary = createSummary(effectiveOptions, selection);
  summary.proxy_preflight = effectiveOptions.proxy_preflight ?? null;
  summary.concurrency_history = effectiveOptions.concurrencyHistory;
  const projectedLatency = summary.proxy_preflight?.p50_duration_ms;
  summary.projected_duration_seconds = Number.isFinite(projectedLatency)
    ? Math.ceil(selection.selectedCodes.length * projectedLatency / Math.max(1, effectiveOptions.concurrency) / 1000)
    : null;
  summary.projected_over_30_minutes = Number.isFinite(summary.projected_duration_seconds)
    ? summary.projected_duration_seconds > 1800
    : null;
  const selectedEntries = selectedCodes.map((inputCode, itemIndex) => ({ inputCode, itemIndex }));
  const initialResults = await runEntriesWithStage(selectedEntries, {
    attempt: 0,
    concurrency: effectiveOptions.concurrency,
    fetchKline,
    itemIndexForEntry: (entry) => entry.itemIndex,
    options: effectiveOptions,
  });

  const finalResults = new Map();
  let retryEntries = [];
  for (const result of initialResults) {
    addAttempt(summary, result, 0);
    finalResults.set(result.code, result);
    if (result.countKey === "failed") {
      summary.initial_failed += 1;
      if (result.file.retriable) {
        const entry = selectedEntries.find((item) => item.inputCode === result.code || extractStockCode(item.inputCode) === result.code);
        if (entry) {
          retryEntries.push(entry);
        }
      }
    }
  }
  const retriedCodes = new Set(retryEntries.map((entry) => extractStockCode(entry.inputCode)));

  for (let attempt = 1; attempt <= effectiveOptions.retryAttempts && retryEntries.length > 0; attempt += 1) {
    await delay(effectiveOptions.retryDelayMs * (2 ** (attempt - 1)));
    const currentRetryEntries = retryEntries;
    const retryResults = await runEntriesWithStage(currentRetryEntries, {
      attempt,
      concurrency: effectiveOptions.retryConcurrency,
      fetchKline,
      itemIndexForEntry: (entry, retryIndex) => entry.itemIndex + selectedEntries.length * attempt + retryIndex,
      options: effectiveOptions,
      retry: true,
    });

    retryEntries = [];
    for (const result of retryResults) {
      addAttempt(summary, result, attempt);
      finalResults.set(result.code, result);
      if (result.countKey === "failed" && result.file.retriable) {
        const entry = currentRetryEntries.find((item) => item.inputCode === result.code || extractStockCode(item.inputCode) === result.code);
        if (entry) {
          retryEntries.push(entry);
        }
      }
    }
  }

  const finalValues = [...finalResults.values()];
  summarizeFinalResults(summary, finalValues);
  summary.retried = retriedCodes.size;
  summary.retry_success = [...retriedCodes].filter((code) => finalResults.get(code)?.countKey !== "failed").length;
  summary.retry_failed = [...retriedCodes].filter((code) => finalResults.get(code)?.countKey === "failed").length;

  finalizeSummary(summary, effectiveOptions);

  const summaryPath = path.join(periodDir, `summary.${effectiveOptions.period}.json`);
  stageLog("start", "kline_summary_write", {
    failed: summary.failed,
    path: summaryPath,
    success: summary.success,
    total_codes: summary.total_codes,
  });
  await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  if (proxyRuntime) await proxyRuntime.close();
  stageLog("end", "kline_summary_write", {
    path: summaryPath,
    status: summary.status,
  });
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
  calculateIncrementalLimit,
  defaultConcurrency,
  mergeKlinePayload,
  parseArguments,
  queryPoolKlines,
};
