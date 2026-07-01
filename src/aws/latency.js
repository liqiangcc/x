"use strict";

const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");
const { inferSecid } = require("../core/secid");
const {
  ACCESS_KEY_ENV: HUAWEICLOUD_ACCESS_KEY_ENV,
  SECRET_KEY_ENV: HUAWEICLOUD_SECRET_KEY_ENV,
  invokeFunctionGraph,
  loadHuaweiCloudTargets,
  normalizeHuaweiCloudTarget,
} = require("../huaweicloud/functiongraph");

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
const PERIOD_MAP = {
  daily: 101,
  yearly: 106,
};
const VALID_ENGINES = new Set(["aws", "aws-router", "huaweicloud", "both", "all"]);
const VALID_ROUTER_MODES = new Set(["probe", "kline"]);

function nowMs() {
  return Date.now();
}

function parsePositiveInteger(value, fallback, name) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return number;
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

function resolveAwsRegions(value, configRegions = DEFAULT_AWS_REGIONS) {
  const configuredRegions = Array.isArray(configRegions) && configRegions.length > 0
    ? configRegions.map((region) => String(region).trim()).filter(Boolean)
    : DEFAULT_AWS_REGIONS;
  if (!value || value === "all") {
    return uniqueRegions(configuredRegions);
  }
  const regions = parseRegionList(value);
  if (regions.length === 0) {
    throw new Error("No AWS regions were provided.");
  }
  return uniqueRegions(regions);
}

function resolveRouterRegions(value) {
  if (!value || value === "all") {
    return "all";
  }
  const regions = parseRegionList(value);
  if (regions.length === 0) {
    throw new Error("No router target regions were provided.");
  }
  return uniqueRegions(regions);
}

function resolveHuaweiCloudRegions(value, targets) {
  const targetRegions = Object.keys(targets ?? {}).sort();
  if (!value || value === "all") {
    return targetRegions.length > 0 ? targetRegions : ["unconfigured"];
  }
  const regions = parseRegionList(value);
  if (regions.length === 0) {
    throw new Error("No Huawei Cloud regions were provided.");
  }
  return uniqueRegions(regions);
}

function shouldRunAws(engine) {
  return engine === "aws" || engine === "both" || engine === "all";
}

function shouldRunAwsRouter(engine) {
  return engine === "aws-router" || engine === "both" || engine === "all";
}

function shouldRunHuaweiCloud(engine) {
  return engine === "huaweicloud" || engine === "all";
}

function resolveHuaweiCloudTargets(rawOptions, config) {
  try {
    return {
      error: null,
      targets: rawOptions.huaweicloudTargetsData ?? config.huaweicloud_targets ?? loadHuaweiCloudTargets({
        env: rawOptions.env ?? process.env,
        targetsFile: rawOptions.huaweicloudTargets ?? null,
      }),
    };
  } catch (error) {
    return {
      error: error?.message ?? String(error),
      targets: {},
    };
  }
}

function normalizeLatencyOptions(rawOptions = {}, config = {}) {
  const engine = rawOptions.engine ?? "both";
  if (!VALID_ENGINES.has(engine)) {
    throw new Error(`Invalid latency engine: ${engine}`);
  }

  const period = rawOptions.period ?? "daily";
  const klt = PERIOD_MAP[period];
  if (!klt) {
    throw new Error(`Invalid period: ${period}`);
  }

  const routerMode = rawOptions.routerMode ?? "probe";
  if (!VALID_ROUTER_MODES.has(routerMode)) {
    throw new Error(`Invalid router mode: ${routerMode}`);
  }

  const regionAlias = rawOptions.region ?? null;
  const awsRegionValue = rawOptions.awsRegion ?? regionAlias ?? null;
  const targetRegionValue = rawOptions.targetRegion ?? regionAlias ?? "all";
  const huaweiCloudTargetsResult = shouldRunHuaweiCloud(engine)
    ? resolveHuaweiCloudTargets(rawOptions, config)
    : { error: null, targets: {} };
  const huaweiCloudTargets = huaweiCloudTargetsResult.targets;
  const huaweiCloudRegionValue = rawOptions.huaweicloudRegion ?? regionAlias ?? "all";
  const awsRegions = shouldRunAws(engine)
    ? resolveAwsRegions(awsRegionValue, config.aws_regions)
    : [];
  const routerRegions = shouldRunAwsRouter(engine)
    ? resolveRouterRegions(targetRegionValue)
    : [];
  const huaweiCloudRegions = shouldRunHuaweiCloud(engine)
    ? resolveHuaweiCloudRegions(huaweiCloudRegionValue, huaweiCloudTargets)
    : [];

  if (routerMode === "kline" && routerRegions === "all") {
    throw new Error("aws-router kline latency requires explicit --target-region/--region values; use --router-mode probe for all.");
  }

  return {
    attempts: parsePositiveInteger(rawOptions.attempts, 3, "attempts"),
    awsRegions,
    end: String(rawOptions.end ?? "20991231"),
    engine,
    klt,
    lambdaName: rawOptions.lambdaName ?? config.lambda_name ?? "kline",
    lmt: parsePositiveInteger(rawOptions.lmt, 1, "lmt"),
    period,
    requestedRegions: {
      aws_region: rawOptions.awsRegion ?? null,
      huaweicloud_region: rawOptions.huaweicloudRegion ?? null,
      region: regionAlias,
      target_region: rawOptions.targetRegion ?? null,
    },
    routerMode,
    routerRegions,
    routerTokenEnv: config.aws_router_token_env ?? "AWS_ROUTER_TOKEN",
    routerUrlEnv: config.aws_router_url_env ?? "AWS_ROUTER_URL",
    secid: inferSecid(rawOptions.secid ?? "1.600519"),
    huaweiCloudAccessKeyEnv: config.huaweicloud_access_key_env ?? HUAWEICLOUD_ACCESS_KEY_ENV,
    huaweiCloudRegions,
    huaweiCloudSecretKeyEnv: config.huaweicloud_secret_key_env ?? HUAWEICLOUD_SECRET_KEY_ENV,
    huaweiCloudTargetLoadError: huaweiCloudTargetsResult.error,
    huaweiCloudTargets,
  };
}

function percentile(sortedValues, percentileValue) {
  if (sortedValues.length === 0) {
    return null;
  }
  const index = Math.ceil(sortedValues.length * percentileValue) - 1;
  return sortedValues[Math.max(0, Math.min(index, sortedValues.length - 1))];
}

function summaryDuration(result) {
  return Number.isFinite(result.router_reported_duration_ms)
    ? result.router_reported_duration_ms
    : result.client_duration_ms;
}

function summarizeResults(results) {
  const summary = {};
  for (const result of results) {
    summary[result.engine] ??= { regions: {} };
    const regionSummary = summary[result.engine].regions[result.region] ?? {
      attempts: 0,
      avg_ms: null,
      failures: 0,
      max_ms: null,
      min_ms: null,
      p50_ms: null,
      p95_ms: null,
      successes: 0,
      success_rate: 0,
    };
    regionSummary.attempts += 1;
    if (result.ok) {
      regionSummary.successes += 1;
    } else {
      regionSummary.failures += 1;
    }
    summary[result.engine].regions[result.region] = regionSummary;
  }

  for (const [engine, engineSummary] of Object.entries(summary)) {
    let engineAttempts = 0;
    let engineSuccesses = 0;
    for (const [region, regionSummary] of Object.entries(engineSummary.regions)) {
      const values = results
        .filter((result) => result.engine === engine && result.region === region && Number.isFinite(result.client_duration_ms))
        .map((result) => summaryDuration(result))
        .sort((left, right) => left - right);
      regionSummary.min_ms = values[0] ?? null;
      regionSummary.max_ms = values.at(-1) ?? null;
      regionSummary.avg_ms = values.length > 0
        ? values.reduce((total, value) => total + value, 0) / values.length
        : null;
      regionSummary.p50_ms = percentile(values, 0.5);
      regionSummary.p95_ms = percentile(values, 0.95);
      regionSummary.success_rate = regionSummary.attempts === 0
        ? 0
        : regionSummary.successes / regionSummary.attempts;
      engineAttempts += regionSummary.attempts;
      engineSuccesses += regionSummary.successes;
    }
    engineSummary.attempts = engineAttempts;
    engineSummary.successes = engineSuccesses;
    engineSummary.success_rate = engineAttempts === 0 ? 0 : engineSuccesses / engineAttempts;
  }

  return summary;
}

function parseJsonText(rawText) {
  return rawText ? JSON.parse(rawText) : {};
}

function parseJsonTextOrNull(rawText) {
  try {
    return parseJsonText(rawText);
  } catch {
    return null;
  }
}

function countPoints(payload) {
  const body = typeof payload?.body === "string"
    ? parseJsonTextOrNull(payload.body)
    : payload?.body;
  if (Array.isArray(body?.data?.klines)) {
    return body.data.klines.length;
  }
  if (Array.isArray(body?.data)) {
    return body.data.length;
  }
  if (Array.isArray(payload?.data?.klines)) {
    return payload.data.klines.length;
  }
  return null;
}

async function measureAwsRegion(options, region, attempt, deps = {}) {
  const startedAt = nowMs();
  try {
    const client = deps.lambdaClientFactory
      ? deps.lambdaClientFactory(region)
      : new LambdaClient({ region });
    const response = await client.send(new InvokeCommand({
      FunctionName: options.lambdaName,
      Payload: Buffer.from(JSON.stringify({
        debug: false,
        dry_run: true,
        end: options.end,
        format: "json",
        klt: options.klt,
        lmt: options.lmt,
        secid: options.secid,
      })),
    }));
    const rawPayload = Buffer.from(response.Payload ?? []).toString("utf8");
    const payload = parseJsonText(rawPayload);
    if (response.FunctionError) {
      throw new Error(`Lambda function error: ${response.FunctionError}`);
    }
    if (payload.statusCode !== 200) {
      throw new Error(`Lambda returned statusCode ${payload.statusCode}: ${payload.body ?? ""}`);
    }
    return {
      attempt,
      client_duration_ms: nowMs() - startedAt,
      engine: "aws",
      ok: true,
      points: countPoints(payload),
      region,
    };
  } catch (error) {
    return {
      attempt,
      client_duration_ms: nowMs() - startedAt,
      engine: "aws",
      error: error?.message ?? String(error),
      ok: false,
      region,
    };
  }
}

function requiredEnv(env, name) {
  const value = String(env[name] ?? "").trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function appendPath(baseUrl, pathname) {
  return `${String(baseUrl).replace(/\/+$/, "")}${pathname}`;
}

async function postRouterJson(pathname, body, options, deps = {}) {
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const routerUrl = requiredEnv(env, options.routerUrlEnv);
  const routerToken = requiredEnv(env, options.routerTokenEnv);
  const response = await fetchImpl(appendPath(routerUrl, pathname), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-router-token": routerToken,
    },
    body: JSON.stringify(body),
  });
  const rawText = await response.text();
  const payload = parseJsonText(rawText);
  if (!response.ok) {
    throw new Error(`Router returned statusCode ${response.status}: ${payload?.error ?? rawText}`);
  }
  return payload;
}

function routerProbeResult(options, region, attempt, clientDurationMs, item) {
  return {
    attempt,
    client_duration_ms: clientDurationMs,
    eastmoney_duration_ms: item.eastmoney_duration_ms ?? null,
    engine: "aws-router",
    error: item.error ?? null,
    error_class: item.error_class ?? null,
    ok: Boolean(item.ok),
    region,
    router_mode: "probe",
    router_reported_duration_ms: item.total_duration_ms ?? null,
    target_duration_ms: item.target_duration_ms ?? null,
  };
}

async function measureRouterProbe(options, region, attempt, deps = {}) {
  const startedAt = nowMs();
  try {
    const payload = await postRouterJson("/probe", {
      end: options.end,
      klt: options.klt,
      lmt: options.lmt,
      region,
      secid: options.secid,
    }, options, deps);
    const clientDurationMs = nowMs() - startedAt;
    const results = Array.isArray(payload.results) ? payload.results : [];
    return results.map((item) =>
      routerProbeResult(options, item.region ?? region, attempt, clientDurationMs, item)
    );
  } catch (error) {
    return [{
      attempt,
      client_duration_ms: nowMs() - startedAt,
      engine: "aws-router",
      error: error?.message ?? String(error),
      ok: false,
      region,
      router_mode: "probe",
    }];
  }
}

async function measureRouterKline(options, region, attempt, deps = {}) {
  const startedAt = nowMs();
  try {
    const payload = await postRouterJson("/kline", {
      end: options.end,
      klt: options.klt,
      lmt: options.lmt,
      region,
      secid: options.secid,
    }, options, deps);
    return [{
      attempt,
      attempted_regions: payload.attempted_regions ?? null,
      client_duration_ms: nowMs() - startedAt,
      eastmoney_duration_ms: payload.eastmoney_duration_ms ?? null,
      engine: "aws-router",
      fallback_count: payload.fallback_count ?? null,
      ok: payload.ok !== false,
      points: Array.isArray(payload?.data?.klines) ? payload.data.klines.length : null,
      region: payload.source_region ?? region,
      requested_region: region,
      router_mode: "kline",
      router_reported_duration_ms: payload.total_duration_ms ?? null,
      target_duration_ms: payload.target_duration_ms ?? null,
    }];
  } catch (error) {
    return [{
      attempt,
      client_duration_ms: nowMs() - startedAt,
      engine: "aws-router",
      error: error?.message ?? String(error),
      ok: false,
      region,
      router_mode: "kline",
    }];
  }
}

async function measureHuaweiCloudRegion(options, region, attempt, deps = {}) {
  const startedAt = nowMs();
  if (options.huaweiCloudTargetLoadError) {
    return {
      attempt,
      client_duration_ms: nowMs() - startedAt,
      engine: "huaweicloud",
      error: options.huaweiCloudTargetLoadError,
      error_class: "missing_huaweicloud_targets",
      ok: false,
      region,
    };
  }

  if (Object.keys(options.huaweiCloudTargets ?? {}).length === 0) {
    return {
      attempt,
      client_duration_ms: nowMs() - startedAt,
      engine: "huaweicloud",
      error: "Huawei Cloud targets JSON did not contain any deployed regions.",
      error_class: "empty_huaweicloud_targets",
      ok: false,
      region,
    };
  }

  const target = normalizeHuaweiCloudTarget(region, options.huaweiCloudTargets[region]);
  if (!target.ok) {
    return {
      attempt,
      client_duration_ms: nowMs() - startedAt,
      engine: "huaweicloud",
      error: target.error,
      error_class: "missing_huaweicloud_target",
      ok: false,
      region,
    };
  }

  try {
    const env = deps.env ?? process.env;
    const accessKey = String(env[options.huaweiCloudAccessKeyEnv] ?? "").trim();
    const secretKey = String(env[options.huaweiCloudSecretKeyEnv] ?? "").trim();
    const { requestId, resultPayload } = await invokeFunctionGraph({
      accessKey,
      date: deps.date,
      fetchImpl: deps.fetchImpl ?? fetch,
      payload: {
        end: options.end,
        klt: options.klt,
        lmt: options.lmt,
        secid: options.secid,
      },
      secretKey,
      target,
    });
    if (resultPayload?.ok === false) {
      throw Object.assign(new Error(resultPayload.error ?? "Huawei Cloud target returned ok=false."), {
        errorClass: resultPayload.error_class ?? "target_failed",
        requestId,
        resultPayload,
      });
    }
    return {
      attempt,
      client_duration_ms: nowMs() - startedAt,
      eastmoney_duration_ms: resultPayload?.eastmoney_duration_ms ?? null,
      engine: "huaweicloud",
      ok: true,
      points: Array.isArray(resultPayload?.data?.klines) ? resultPayload.data.klines.length : null,
      region,
      request_id: requestId,
      target_duration_ms: resultPayload?.target_duration_ms ?? null,
    };
  } catch (error) {
    return {
      attempt,
      client_duration_ms: nowMs() - startedAt,
      engine: "huaweicloud",
      error: error?.message ?? String(error),
      error_class: error?.errorClass ?? null,
      ok: false,
      region,
      request_id: error?.requestId ?? null,
    };
  }
}

async function runLatencyBenchmark(options, deps = {}) {
  const results = [];
  const startedAt = new Date().toISOString();

  if (shouldRunAws(options.engine)) {
    for (const region of options.awsRegions) {
      for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
        results.push(await measureAwsRegion(options, region, attempt, deps));
      }
    }
  }

  if (shouldRunAwsRouter(options.engine)) {
    if (options.routerMode === "probe") {
      const probeRegions = options.routerRegions === "all" ? ["all"] : options.routerRegions;
      for (const region of probeRegions) {
        for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
          results.push(...await measureRouterProbe(options, region, attempt, deps));
        }
      }
    } else {
      for (const region of options.routerRegions) {
        for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
          results.push(...await measureRouterKline(options, region, attempt, deps));
        }
      }
    }
  }

  if (shouldRunHuaweiCloud(options.engine)) {
    for (const region of options.huaweiCloudRegions) {
      for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
        results.push(await measureHuaweiCloudRegion(options, region, attempt, deps));
      }
    }
  }

  return {
    attempts: options.attempts,
    engine: options.engine,
    environment: {
      aws_region: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? null,
      github_actions: process.env.GITHUB_ACTIONS === "true",
      node: process.version,
      runner_os: process.env.RUNNER_OS ?? null,
    },
    finished_at: new Date().toISOString(),
    klt: options.klt,
    lambda_name: options.lambdaName,
    lmt: options.lmt,
    period: options.period,
    requested_regions: options.requestedRegions,
    resolved_regions: {
      aws: options.awsRegions,
      "aws-router": options.routerRegions,
      huaweicloud: options.huaweiCloudRegions,
    },
    results,
    router_mode: options.routerMode,
    secid: options.secid,
    started_at: startedAt,
    summary: summarizeResults(results),
  };
}

function formatNumber(value) {
  return Number.isFinite(value) ? value.toFixed(1).replace(/\.0$/, "") : "n/a";
}

function formatLatencyReport(report) {
  const lines = [
    `Latency benchmark ${report.secid} ${report.period} lmt=${report.lmt} attempts=${report.attempts}`,
    "engine\tregion\tsuccess\tavg_ms\tp50_ms\tp95_ms\tmin_ms\tmax_ms",
  ];
  for (const [engine, engineSummary] of Object.entries(report.summary)) {
    for (const [region, regionSummary] of Object.entries(engineSummary.regions)) {
      lines.push([
        engine,
        region,
        `${regionSummary.successes}/${regionSummary.attempts}`,
        formatNumber(regionSummary.avg_ms),
        formatNumber(regionSummary.p50_ms),
        formatNumber(regionSummary.p95_ms),
        formatNumber(regionSummary.min_ms),
        formatNumber(regionSummary.max_ms),
      ].join("\t"));
    }
  }
  return `${lines.join("\n")}\n`;
}

module.exports = {
  DEFAULT_AWS_REGIONS,
  formatLatencyReport,
  normalizeLatencyOptions,
  parseRegionList,
  runLatencyBenchmark,
  summarizeResults,
};
