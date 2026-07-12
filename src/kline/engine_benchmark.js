"use strict";

const { applyConfigDefaults, parseArguments, resolveKline } = require("../../fetch/fetch_kline");

const VALID_ENGINES = new Set(["local", "proxy-pool", "aws", "aws-router", "huaweicloud"]);

function percentile(values, ratio) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

function classifyError(error) {
  const message = String(error?.message ?? error ?? "");
  if (/timeout|deadline|ETIMEDOUT/i.test(message)) return "timeout";
  if (/required|credentials|targets|No Huawei|AWS_/i.test(message)) return "unconfigured";
  if (/empty_klines|missing data\.klines/i.test(message)) return "invalid_payload";
  if (/403|Forbidden/i.test(message)) return "forbidden";
  if (/429|rate.?limit/i.test(message)) return "rate_limited";
  return "request_error";
}

function normalizeOptions(raw = {}) {
  const engines = String(raw.engines ?? "local,proxy-pool,aws,aws-router,huaweicloud")
    .split(",").map((item) => item.trim()).filter(Boolean);
  for (const engine of engines) if (!VALID_ENGINES.has(engine)) throw new Error(`Invalid Kline benchmark engine: ${engine}`);
  const attempts = Number(raw.attempts ?? 3);
  const lmt = Number(raw.lmt ?? 1);
  const proxyMaxAttempts = Number(raw.proxyMaxAttempts ?? 1);
  const timeoutMs = Number(raw.timeoutMs ?? 30000);
  if (!Number.isInteger(attempts) || attempts < 1) throw new Error("--attempts must be a positive integer.");
  if (!Number.isInteger(lmt) || lmt < 1) throw new Error("--lmt must be a positive integer.");
  if (!Number.isInteger(proxyMaxAttempts) || proxyMaxAttempts < 1) throw new Error("--proxy-max-attempts must be a positive integer.");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new Error("--timeout-ms must be a positive integer.");
  const period = raw.period ?? "daily";
  if (!["daily", "yearly"].includes(period)) throw new Error("--period must be daily or yearly.");
  return {
    attempts,
    awsRegion: raw.awsRegion ?? null,
    config: raw.config ?? null,
    engines: [...new Set(engines)],
    input: raw.secid ?? raw.code ?? "600519",
    lmt,
    period,
    proxyMaxAttempts,
    routerRegion: raw.routerRegion ?? null,
    timeoutMs,
  };
}

async function fetchEngine(engine, options) {
  const args = [options.input, "--period", options.period, "--engine", engine, "--kline-limit", String(options.lmt)];
  if (options.config) args.push("--config", options.config);
  if (options.awsRegion) args.push("--aws-region", options.awsRegion);
  if (options.routerRegion) args.push("--router-region", options.routerRegion);
  if (engine === "proxy-pool") args.push("--proxy-max-attempts", String(options.proxyMaxAttempts));
  const parsed = parseArguments(args);
  return resolveKline(await applyConfigDefaults(parsed));
}

async function withDeadline(callback, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      callback(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Engine benchmark deadline exceeded after ${timeoutMs}ms`)), timeoutMs); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

function summarize(results, engines) {
  return Object.fromEntries(engines.map((engine) => {
    const rows = results.filter((row) => row.engine === engine);
    const successes = rows.filter((row) => row.ok);
    const durations = successes.map((row) => row.duration_ms);
    const errors = rows.filter((row) => !row.ok).reduce((counts, row) => {
      counts[row.error_class] = (counts[row.error_class] ?? 0) + 1;
      return counts;
    }, {});
    return [engine, {
      attempts: rows.length,
      success: successes.length,
      failed: rows.length - successes.length,
      success_rate: rows.length === 0 ? 0 : successes.length / rows.length,
      avg_ms: durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : null,
      min_ms: durations.length ? Math.min(...durations) : null,
      p50_ms: percentile(durations, 0.5),
      p95_ms: percentile(durations, 0.95),
      p99_ms: percentile(durations, 0.99),
      max_ms: durations.length ? Math.max(...durations) : null,
      error_counts: errors,
    }];
  }));
}

async function runEngineBenchmark(rawOptions = {}, deps = {}) {
  const options = normalizeOptions(rawOptions);
  const requestEngine = deps.fetchEngine ?? fetchEngine;
  const results = [];
  const startedAt = new Date().toISOString();
  for (const engine of options.engines) {
    for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
      const started = Date.now();
      try {
        const payload = await withDeadline(() => requestEngine(engine, options), options.timeoutMs);
        const klines = payload?.data?.klines ?? payload?.klines;
        if (!Array.isArray(klines) || klines.length === 0) throw new Error("Engine returned empty_klines");
        results.push({
          attempt,
          duration_ms: Date.now() - started,
          engine,
          ok: true,
          points: klines.length,
          source_engine: payload.source_engine ?? engine,
          source_region: payload.source_region ?? null,
        });
      } catch (error) {
        results.push({ attempt, duration_ms: Date.now() - started, engine, ok: false, error: error.message, error_class: classifyError(error) });
      }
    }
  }
  return {
    attempts: options.attempts,
    engines: options.engines,
    environment: { node: process.version },
    finished_at: new Date().toISOString(),
    input: options.input,
    lmt: options.lmt,
    period: options.period,
    results,
    started_at: startedAt,
    summary: summarize(results, options.engines),
  };
}

module.exports = { classifyError, normalizeOptions, runEngineBenchmark, summarize, withDeadline };
