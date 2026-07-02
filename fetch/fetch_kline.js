#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const { getKline } = require("../src/sources/eastmoney/client");
const { inferSecid, splitSecid } = require("../src/core/secid");
const { stageLog, withStage } = require("../src/core/stage_log");
const {
  ACCESS_KEY_ENV: HUAWEICLOUD_ACCESS_KEY_ENV,
  SECRET_KEY_ENV: HUAWEICLOUD_SECRET_KEY_ENV,
  invokeFunctionGraph,
  loadHuaweiCloudTargets,
  normalizeHuaweiCloudTarget,
} = require("../src/huaweicloud/functiongraph");

const CONFIG_FILE = path.resolve(__dirname, "../config/kline.json");
const PERIOD_MAP = {
  daily: "101",
  yearly: "106",
};
const DEFAULT_KLINE_LMT = 10000;
const DEFAULT_AWS_REGIONS = [
  "ap-northeast-1",
  "ap-northeast-2",
  "ap-northeast-3",
  "ap-south-1",
  "ap-southeast-1",
  "ap-southeast-2",
  "ca-central-1",
  "eu-central-1",
  "eu-north-1",
  "eu-west-1",
  "eu-west-2",
  "eu-west-3",
  "sa-east-1",
  "us-east-1",
  "us-east-2",
  "us-west-1",
  "us-west-2",
];
const VALID_ENGINES = new Set(["auto", "local", "aws", "aws-router", "huaweicloud"]);

function printUsage() {
  console.error(
    "Usage: node fetch/fetch_kline.js <code_or_secid> [--period <daily|yearly>] [--engine <auto|local|aws|aws-router|huaweicloud>] [--aws-region <r1,r2,...>] [--aws-region-start-index <N>] [--huaweicloud-region <all|r1,r2,...>] [--huaweicloud-region-start-index <N>] [--huaweicloud-targets <file>] [--lambda-name <name>] [--config <file>] [--output <file>]"
  );
}

function parseNonNegativeInteger(value, flagName) {
  if (!value || !/^\d+$/.test(value)) {
    throw new Error(`Invalid value for ${flagName}: ${value ?? ""}`);
  }
  return Number(value);
}

function rotateRegions(regions, startIndex) {
  if (!Array.isArray(regions) || regions.length === 0) {
    return [];
  }
  const offset = startIndex % regions.length;
  return [...regions.slice(offset), ...regions.slice(0, offset)];
}

function parseRegionList(value) {
  return String(value ?? "")
    .split(",")
    .map((region) => region.trim())
    .filter(Boolean);
}

function uniqueRegions(regions) {
  return [...new Set(regions)];
}

function parseArguments(argv) {
  const options = {
    awsRegions: [...DEFAULT_AWS_REGIONS],
    awsRegionsOverridden: false,
    awsRegionStartIndex: 0,
    configFile: CONFIG_FILE,
    engine: "auto",
    huaweiCloudAccessKeyEnv: HUAWEICLOUD_ACCESS_KEY_ENV,
    huaweiCloudRegionStartIndex: 0,
    huaweiCloudRegionValue: "all",
    huaweiCloudSecretKeyEnv: HUAWEICLOUD_SECRET_KEY_ENV,
    huaweiCloudTargets: null,
    huaweiCloudTargetsFile: null,
    input: null,
    lambdaName: "kline",
    lambdaNameOverridden: false,
    outputFile: null,
    period: "daily",
    routerRegion: "auto",
    routerTokenEnv: "AWS_ROUTER_TOKEN",
    routerUrlEnv: "AWS_ROUTER_URL",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--period") {
      const nextArg = argv[index + 1];
      if (!nextArg || !Object.prototype.hasOwnProperty.call(PERIOD_MAP, nextArg)) {
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
      const regions = nextArg
        .split(",")
        .map((region) => region.trim())
        .filter(Boolean);
      if (regions.length === 0) {
        throw new Error("No valid AWS regions were provided.");
      }
      options.awsRegions = regions;
      options.awsRegionsOverridden = true;
      index += 1;
      continue;
    }

    if (arg === "--aws-region-start-index") {
      const nextArg = argv[index + 1];
      options.awsRegionStartIndex = parseNonNegativeInteger(nextArg, "--aws-region-start-index");
      index += 1;
      continue;
    }

    if (arg === "--huaweicloud-region") {
      const nextArg = argv[index + 1];
      if (!nextArg) {
        throw new Error("Missing value for --huaweicloud-region.");
      }
      options.huaweiCloudRegionValue = nextArg;
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
      options.lambdaNameOverridden = true;
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

    if (arg === "--output" || arg === "-o") {
      const nextArg = argv[index + 1];
      if (!nextArg) {
        throw new Error("Missing value for --output.");
      }
      options.outputFile = path.resolve(nextArg);
      index += 1;
      continue;
    }

    if (options.input) {
      throw new Error("Only one code_or_secid is supported.");
    }
    options.input = arg;
  }

  if (!options.input) {
    printUsage();
    process.exitCode = 1;
    return null;
  }

  return options;
}

async function applyConfigDefaults(options) {
  try {
    const raw = await fs.readFile(options.configFile, "utf8");
    const config = JSON.parse(raw);

    if (!options.awsRegionsOverridden && Array.isArray(config?.aws_regions) && config.aws_regions.length > 0) {
      options.awsRegions = config.aws_regions
        .map((region) => String(region).trim())
        .filter(Boolean);
    }

    if (!options.lambdaNameOverridden && typeof config?.lambda_name === "string" && config.lambda_name.trim()) {
      options.lambdaName = config.lambda_name.trim();
    }

    if (typeof config?.aws_router_url_env === "string" && config.aws_router_url_env.trim()) {
      options.routerUrlEnv = config.aws_router_url_env.trim();
    }

    if (typeof config?.aws_router_token_env === "string" && config.aws_router_token_env.trim()) {
      options.routerTokenEnv = config.aws_router_token_env.trim();
    }

    if (config?.huaweicloud_targets && typeof config.huaweicloud_targets === "object" && !Array.isArray(config.huaweicloud_targets)) {
      options.huaweiCloudTargets = config.huaweicloud_targets;
    }

    if (typeof config?.huaweicloud_access_key_env === "string" && config.huaweicloud_access_key_env.trim()) {
      options.huaweiCloudAccessKeyEnv = config.huaweicloud_access_key_env.trim();
    }

    if (typeof config?.huaweicloud_secret_key_env === "string" && config.huaweicloud_secret_key_env.trim()) {
      options.huaweiCloudSecretKeyEnv = config.huaweicloud_secret_key_env.trim();
    }
  } catch (error) {
    if (error.code === "ENOENT") {
      return options;
    }
    throw new Error(`Failed to load config ${options.configFile}: ${error.message}`);
  }

  options.awsRegions = rotateRegions(options.awsRegions, options.awsRegionStartIndex);
  return options;
}

function resolveHuaweiCloudTargets(options, env = process.env) {
  return options.huaweiCloudTargets ?? loadHuaweiCloudTargets({
    env,
    targetsFile: options.huaweiCloudTargetsFile,
  });
}

function resolveHuaweiCloudRegions(value, targets) {
  const targetRegions = Object.keys(targets ?? {}).sort();
  if (!value || value === "all") {
    return targetRegions;
  }
  const regions = parseRegionList(value);
  if (regions.length === 0) {
    throw new Error("No Huawei Cloud regions were provided.");
  }
  return uniqueRegions(regions);
}

async function fetchLocalKline(secid, klt) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await getKline({
        secid,
        klt,
        lmt: DEFAULT_KLINE_LMT,
        end: "20991231",
      });
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => {
          setTimeout(resolve, attempt * 500);
        });
      }
    }
  }
  throw lastError;
}

async function invokeAwsRegion(secid, klt, awsRegion, lambdaName) {
  let LambdaClient;
  let InvokeCommand;
  try {
    ({ LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda"));
  } catch {
    throw new Error("AWS engine requires npm install for @aws-sdk/client-lambda.");
  }

  const client = new LambdaClient({ region: awsRegion });
  const payload = JSON.stringify({
    secid,
    klt: Number(klt),
    lmt: DEFAULT_KLINE_LMT,
    dry_run: true,
    format: "json",
    debug: false,
    end: "20991231",
  });
  const response = await client.send(
    new InvokeCommand({
      FunctionName: lambdaName,
      Payload: Buffer.from(payload),
    })
  );

  const rawPayload = Buffer.from(response.Payload ?? []).toString("utf8");
  const invokePayload = JSON.parse(rawPayload);

  if (response.FunctionError) {
    throw new Error(`Lambda function error: ${response.FunctionError}`);
  }
  if (invokePayload.statusCode !== 200) {
    throw new Error(`Lambda returned statusCode ${invokePayload.statusCode}: ${invokePayload.body ?? ""}`);
  }

  return typeof invokePayload.body === "string"
    ? JSON.parse(invokePayload.body)
    : invokePayload.body;
}

function normalizeKlineData(rawData, secid, sourceEngine, sourceRegion = null) {
  if (Array.isArray(rawData?.data?.klines)) {
    return {
      ...rawData,
      source_engine: sourceEngine,
      source_region: sourceRegion,
    };
  }

  if (Array.isArray(rawData?.data)) {
    const { code, market } = splitSecid(secid);
    const klines = rawData.data.map((item) =>
      [
        item.f51,
        item.f52,
        item.f53,
        item.f54,
        item.f55,
        item.f56,
        item.f57,
        item.f58,
        item.f59,
        item.f60,
        item.f61,
      ].join(",")
    );

    return {
      rc: 0,
      source_engine: sourceEngine,
      source_region: sourceRegion,
      meta: rawData.meta ?? null,
      data: {
        code,
        market,
        klines,
      },
    };
  }

  return {
    ...rawData,
    source_engine: sourceEngine,
    source_region: sourceRegion,
  };
}

function klineCount(payload) {
  if (Array.isArray(payload?.data?.klines)) {
    return payload.data.klines.length;
  }
  return null;
}

function assertRemoteKlinesAvailable(payload, sourceEngine, sourceRegion) {
  const count = klineCount(payload);
  if (count === 0) {
    throw new Error(`${sourceEngine} ${sourceRegion ?? "unknown"} returned empty_klines`);
  }
  return payload;
}

async function fetchAwsKline(secid, klt, awsRegions, lambdaName) {
  let lastError;
  for (const region of awsRegions) {
    try {
      const rawData = await invokeAwsRegion(secid, klt, region, lambdaName);
      return assertRemoteKlinesAvailable(
        normalizeKlineData(rawData, secid, "aws", region),
        "aws",
        region
      );
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function fetchHuaweiCloudKline(secid, klt, options, env = process.env, fetchImpl = fetch) {
  const targets = resolveHuaweiCloudTargets(options, env);
  const regions = rotateRegions(
    resolveHuaweiCloudRegions(options.huaweiCloudRegionValue, targets),
    options.huaweiCloudRegionStartIndex
  );
  if (regions.length === 0) {
    throw new Error("No Huawei Cloud FunctionGraph regions were resolved.");
  }

  const accessKey = String(env[options.huaweiCloudAccessKeyEnv] ?? "").trim();
  const secretKey = String(env[options.huaweiCloudSecretKeyEnv] ?? "").trim();
  let lastError;
  for (const region of regions) {
    const startedAt = Date.now();
    try {
      const target = normalizeHuaweiCloudTarget(region, targets[region]);
      if (!target.ok) {
        throw new Error(target.error);
      }
      const { requestId, resultPayload } = await invokeFunctionGraph({
        accessKey,
        fetchImpl,
        payload: {
          end: "20991231",
          klt: Number(klt),
          lmt: DEFAULT_KLINE_LMT,
          secid,
        },
        secretKey,
        target,
      });
      if (resultPayload?.ok === false) {
        throw new Error(`Huawei Cloud target returned ${resultPayload.error_class ?? "error"}: ${resultPayload.error ?? ""}`);
      }
      const totalDurationMs = Date.now() - startedAt;
      return assertRemoteKlinesAvailable(
        normalizeKlineData({
          ...resultPayload,
          request_id: resultPayload?.request_id ?? requestId,
          total_duration_ms: Number.isFinite(resultPayload?.total_duration_ms)
            ? resultPayload.total_duration_ms
            : totalDurationMs,
        }, secid, "huaweicloud", resultPayload?.source_region ?? region),
        "huaweicloud",
        resultPayload?.source_region ?? region
      );
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function appendPath(baseUrl, pathname) {
  return `${String(baseUrl).replace(/\/+$/, "")}${pathname}`;
}

async function fetchAwsRouterKline(secid, klt, options, env = process.env, fetchImpl = fetch) {
  const routerUrl = String(env[options.routerUrlEnv] ?? "").trim();
  const routerToken = String(env[options.routerTokenEnv] ?? "").trim();
  if (!routerUrl) {
    throw new Error(`${options.routerUrlEnv} is required for aws-router engine.`);
  }
  if (!routerToken) {
    throw new Error(`${options.routerTokenEnv} is required for aws-router engine.`);
  }

  const response = await fetchImpl(appendPath(routerUrl, "/kline"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-router-token": routerToken,
    },
    body: JSON.stringify({
      region: options.routerRegion ?? "auto",
      secid,
      klt: Number(klt),
      lmt: DEFAULT_KLINE_LMT,
      end: "20991231",
    }),
  });

  const rawText = await response.text();
  let payload;
  try {
    payload = rawText ? JSON.parse(rawText) : {};
  } catch (error) {
    throw new Error(`Failed to parse aws-router response: ${error.message}`);
  }

  if (!response.ok || payload?.ok === false) {
    throw new Error(`aws-router returned statusCode ${response.status}: ${payload?.error ?? rawText}`);
  }

  return normalizeKlineData(payload, secid, "aws-router", payload.source_region ?? null);
}

async function resolveKline(options, deps = {}) {
  const fetchAws = deps.fetchAwsKline ?? fetchAwsKline;
  const fetchHuaweiCloud = deps.fetchHuaweiCloudKline ?? fetchHuaweiCloudKline;
  const fetchLocal = deps.fetchLocalKline ?? fetchLocalKline;
  const fetchRouter = deps.fetchAwsRouterKline ?? fetchAwsRouterKline;
  const secid = inferSecid(options.input);
  const klt = PERIOD_MAP[options.period];
  stageLog("start", "fetch_kline_resolve", {
    engine: options.engine,
    input: options.input,
    period: options.period,
    secid,
  });

  if (options.engine === "local") {
    const rawData = await withStage("fetch_kline_local", { period: options.period, secid }, () =>
      fetchLocal(secid, klt)
    );
    return normalizeKlineData(rawData, secid, "local");
  }

  if (options.engine === "aws") {
    return withStage("fetch_kline_aws", { period: options.period, region_count: options.awsRegions.length, secid }, () =>
      fetchAws(secid, klt, options.awsRegions, options.lambdaName)
    );
  }

  if (options.engine === "aws-router") {
    return withStage("fetch_kline_aws_router", {
      period: options.period,
      router_region: options.routerRegion ?? "auto",
      secid,
    }, () =>
      fetchRouter(secid, klt, options)
    );
  }

  if (options.engine === "huaweicloud") {
    return withStage("fetch_kline_huaweicloud", { period: options.period, secid }, () =>
      fetchHuaweiCloud(secid, klt, options)
    );
  }

  let huaweiCloudError = null;
  try {
    return await withStage("fetch_kline_huaweicloud", { period: options.period, secid }, () =>
      fetchHuaweiCloud(secid, klt, options)
    );
  } catch (error) {
    huaweiCloudError = error;
  }

  let awsError = null;
  try {
    return await withStage("fetch_kline_aws", { period: options.period, region_count: options.awsRegions.length, secid }, () =>
      fetchAws(secid, klt, options.awsRegions, options.lambdaName)
    );
  } catch (error) {
    awsError = error;
  }

  try {
    const rawData = await withStage("fetch_kline_local", { period: options.period, secid }, () =>
      fetchLocal(secid, klt)
    );
    return normalizeKlineData(rawData, secid, "local");
  } catch (localError) {
    throw new Error(
      [
        `Huawei Cloud failed: ${huaweiCloudError?.message ?? "unknown error"}`,
        `AWS failed: ${awsError?.message ?? "unknown error"}`,
        `Local failed: ${localError.message}`,
      ].join(" | ")
    );
  }
}

async function main() {
  const cliOptions = parseArguments(process.argv.slice(2));
  if (!cliOptions) {
    return;
  }

  const options = await applyConfigDefaults(cliOptions);
  const data = await resolveKline(options);
  const output = `${JSON.stringify(data, null, 2)}\n`;

  if (options.outputFile) {
    await fs.mkdir(path.dirname(options.outputFile), { recursive: true });
    await fs.writeFile(options.outputFile, output, "utf8");
    console.log(options.outputFile);
    return;
  }

  process.stdout.write(output);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  applyConfigDefaults,
  fetchAwsKline,
  fetchAwsRouterKline,
  fetchHuaweiCloudKline,
  fetchLocalKline,
  normalizeKlineData,
  parseArguments,
  resolveKline,
};
