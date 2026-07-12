"use strict";

const path = require("node:path");
const { JsonHealthStore, readHealthState: readHealthStateV2 } = require("./health/store");
const { normalizeProxy, proxyId } = require("./model");
const { ProxyManager } = require("./manager");
const { ProxyPoolProvider, parseProxyList, readLocalPoolEnv } = require("./providers/proxypool");
const { buildKlineUrl, createEastmoneyKlineProbe, TARGET } = require("./probes/eastmoney_kline");
const { rankCandidates } = require("./selectors");
const { requestThroughProxy } = require("./transport/http_proxy");

const ROOT = path.resolve(__dirname, "../..");
const DEFAULT_POOL_URL = "http://127.0.0.1:5555";
const DEFAULT_STATE_FILE = path.join(ROOT, "var/proxy-pool/ttjj-health.json");
const UPSTREAM_PROXY_POOL = {
  repository: "https://github.com/Python3WebSpider/ProxyPool",
  commit: "cabcd96cc9f30d7bdbc872bb8a8c52760023c142",
  license: "MIT",
};

async function fetchProxyCandidates({
  apiKey = process.env.X_PROXY_POOL_API_KEY ?? process.env.PROXY_POOL_API_KEY ?? "",
  count = 50,
  fetchImpl = fetch,
  poolUrl = process.env.X_PROXY_POOL_URL ?? DEFAULT_POOL_URL,
} = {}) {
  const provider = new ProxyPoolProvider({ apiKey, count, fetchImpl, poolUrl });
  return (await provider.listCandidates()).map((proxy) => proxy.endpoint);
}

async function fetchAllProxyCandidates({
  apiKey = process.env.X_PROXY_POOL_API_KEY ?? process.env.PROXY_POOL_API_KEY ?? "",
  fetchImpl = fetch,
  poolUrl = process.env.X_PROXY_POOL_URL ?? DEFAULT_POOL_URL,
} = {}) {
  const provider = new ProxyPoolProvider({ all: true, apiKey, fetchImpl, poolUrl });
  return (await provider.listCandidates()).map((proxy) => proxy.endpoint);
}

function classifyProxyError(error) {
  const message = String(error?.message ?? error ?? "");
  if (/UND_ERR_CONNECT_TIMEOUT|Connect Timeout/i.test(message)) return "proxy_connect_timeout";
  if (/headers timeout|UND_ERR_HEADERS_TIMEOUT/i.test(message)) return "headers_timeout";
  if (/body timeout|UND_ERR_BODY_TIMEOUT/i.test(message)) return "body_timeout";
  if (/HTTP 429|Too Many Requests/i.test(message)) {
    return "rate_limited";
  }
  if (/HTTP 403|Forbidden/i.test(message)) {
    return "forbidden";
  }
  if (/certificate|CERT_|TLS|SSL/i.test(message)) {
    return "tls_error";
  }
  if (/timeout|timed out|AbortError/i.test(message)) {
    return "total_timeout";
  }
  if (/empty|missing data\.klines|invalid JSON|Unexpected token/i.test(message)) {
    return "invalid_payload";
  }
  return "network_error";
}

function cooldownMs(errorClass) {
  if (["forbidden", "rate_limited"].includes(errorClass)) {
    return 2 * 60 * 60 * 1000;
  }
  if (["tls_error", "invalid_payload"].includes(errorClass)) {
    return 24 * 60 * 60 * 1000;
  }
  return 30 * 60 * 1000;
}

function adaptiveTimeouts(proxy, state, { full = false, headersTimeoutMs } = {}) {
  const health = state.proxies?.[proxy.id]?.targets?.[TARGET] ?? {};
  const observed = Number(health.p95_latency_ms ?? health.ewma_latency_ms ?? 2000);
  const adaptiveHeadersTimeoutMs = Number.isFinite(headersTimeoutMs)
    ? Math.max(2000, Math.min(10000, headersTimeoutMs))
    : Math.max(2000, Math.min(10000, Math.ceil(observed * 1.5)));
  const bodyTimeoutMs = full ? 6000 : 3000;
  return {
    bodyTimeoutMs,
    connectTimeoutMs: 2000,
    headersTimeoutMs: adaptiveHeadersTimeoutMs,
    totalTimeoutMs: full ? 20000 : 15000,
  };
}

async function requestKlineThroughProxy(proxy, input = {}, options = {}) {
  const probe = createEastmoneyKlineProbe(input);
  const response = await requestThroughProxy(normalizeProxy(proxy), { ...probe.request, timeoutMs: options.timeoutMs }, options);
  return { payload: probe.validate(response), durationMs: response.durationMs };
}

async function readHealthState(stateFile = DEFAULT_STATE_FILE) {
  return readHealthStateV2(stateFile);
}

async function recordProxyResult(proxy, result, stateFile = DEFAULT_STATE_FILE) {
  return new JsonHealthStore({ stateFile, cooldownForError: cooldownMs }).record(proxy, TARGET, result);
}

function orderCandidates(candidates, state, nowMs = Date.now(), random = Math.random, options = {}) {
  const normalized = candidates.map((proxy) => normalizeProxy(proxy, { source: "proxypool" }));
  const migrated = state.version === 2 ? state : {
    version: 2,
    proxies: Object.fromEntries(Object.entries(state.proxies ?? {}).map(([id, entry]) => [id, {
      proxy: normalizeProxy(entry.proxy ?? ""),
      targets: { [TARGET]: { cooldown_until: entry.cooldown_until, ewma_latency_ms: entry.last_latency_ms, success_rate: Number(entry.success_count ?? 0) > 0 ? 1 : 0 } },
    }])),
  };
  return rankCandidates(normalized, migrated, {
    explorationRate: options.explorationRate ?? 0.1,
    nowMs,
    random,
    strategy: options.strategy ?? "balanced",
    target: TARGET,
    timeoutMs: options.timeoutMs,
  })
    .map((proxy) => proxy.endpoint);
}

async function getKlineViaProxyPool(input, options = {}) {
  const stateFile = options.stateFile ?? process.env.X_PROXY_POOL_STATE_FILE ?? DEFAULT_STATE_FILE;
  if (!options.fetchCandidatesImpl && !options.requestKlineImpl && !options.recordResultImpl) {
    const runtime = options.proxyRuntime;
    const manager = new ProxyManager({
      classifyError: classifyProxyError,
      healthStore: runtime?.healthStore ?? new JsonHealthStore({ stateFile, cooldownForError: cooldownMs }),
      provider: runtime ? { listCandidates: async () => runtime.listCandidates() } : new ProxyPoolProvider({
        apiKey: options.apiKey,
        count: options.count,
        fetchImpl: options.fetchImpl,
        poolUrl: options.poolUrl,
      }),
      transport: runtime
        ? (proxy, requestOptions) => runtime.transport.request(proxy, requestOptions)
        : (proxy, requestOptions) => requestThroughProxy(proxy, requestOptions, options),
    });
    const result = await manager.execute({
      acquire: runtime ? (proxy) => runtime.acquire(proxy) : null,
      attempts: options.maxAttempts ?? 3,
      explorationRate: options.explorationRate,
      probe: createEastmoneyKlineProbe(input),
      random: options.random,
      release: runtime ? (proxy) => runtime.release(proxy) : null,
      strategy: options.strategy ?? "balanced",
      timeoutResolver: (proxy, state) => adaptiveTimeouts(proxy, state, {
        full: Number(input.lmt ?? 1) >= 10000,
        headersTimeoutMs: options.timeoutMs,
      }),
      timeoutMs: options.timeoutMs,
    });
    return {
      ...result.payload,
      source_engine: "proxy-pool",
      source_region: "CN",
      total_duration_ms: result.durationMs,
      proxy_attempts: result.attempts,
      proxy_id: result.proxy.id,
      proxy_error_counts: result.failures.reduce((counts, failure) => {
        counts[failure.error_class] = (counts[failure.error_class] ?? 0) + 1;
        return counts;
      }, {}),
      proxy_selector: options.strategy ?? "balanced",
      proxy_target: TARGET,
    };
  }
  const fetchCandidates = options.fetchCandidatesImpl ?? fetchProxyCandidates;
  const requestKline = options.requestKlineImpl ?? requestKlineThroughProxy;
  const recordResult = options.recordResultImpl ?? recordProxyResult;
  const candidates = await fetchCandidates(options);
  if (candidates.length === 0) {
    throw new Error("ProxyPool returned no valid CN proxy candidates.");
  }
  const state = await readHealthState(stateFile);
  const ordered = orderCandidates(candidates, state, Date.now(), options.random ?? Math.random, {
    explorationRate: options.explorationRate,
    strategy: options.strategy,
    timeoutMs: options.timeoutMs,
  });
  const maxAttempts = Math.min(Number(options.maxAttempts ?? 3), ordered.length);
  const failures = [];
  for (const proxy of ordered.slice(0, maxAttempts)) {
    const id = proxyId(proxy);
    const startedAt = Date.now();
    try {
      const result = await requestKline(proxy, input, options);
      await recordResult(proxy, { ok: true, durationMs: result.durationMs }, stateFile);
      return {
        ...result.payload,
        source_engine: "proxy-pool",
        source_region: "CN",
        total_duration_ms: Date.now() - startedAt,
        proxy_attempts: failures.length + 1,
        proxy_id: id,
        proxy_error_counts: failures.reduce((counts, failure) => {
          counts[failure.error_class] = (counts[failure.error_class] ?? 0) + 1;
          return counts;
        }, {}),
      };
    } catch (error) {
      const errorClass = classifyProxyError(error);
      await recordResult(proxy, {
        ok: false,
        durationMs: Date.now() - startedAt,
        errorClass,
      }, stateFile);
      failures.push({ proxy_id: id, error_class: errorClass, error: error.message });
    }
  }
  const error = new Error(`All proxy-pool attempts failed: ${failures.map((item) => `${item.proxy_id}:${item.error_class}`).join(", ")}`);
  error.failures = failures;
  throw error;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await mapper(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

async function runProxyBenchmark({
  codes = ["1.600519", "0.000001", "0.300750", "1.601318"],
  concurrency = 4,
  samples = 100,
  ...options
} = {}) {
  const tasks = Array.from({ length: samples }, (_, index) => codes[index % codes.length]);
  const startedAt = new Date().toISOString();
  const results = await mapWithConcurrency(tasks, concurrency, async (secid) => {
    const started = Date.now();
    try {
      const payload = await getKlineViaProxyPool({ secid, klt: 101, lmt: 1 }, options);
      return {
        ok: true,
        duration_ms: Date.now() - started,
        proxy_attempts: payload.proxy_attempts,
        proxy_id: payload.proxy_id,
        secid,
      };
    } catch (error) {
      return {
        ok: false,
        duration_ms: Date.now() - started,
        error: error.message,
        secid,
      };
    }
  });
  const durations = results.filter((item) => item.ok).map((item) => item.duration_ms).sort((a, b) => a - b);
  const percentile = (value) => durations.length === 0
    ? null
    : durations[Math.max(0, Math.ceil(durations.length * value) - 1)];
  const successes = results.filter((item) => item.ok).length;
  const proxyIds = new Set(results.filter((item) => item.ok).map((item) => item.proxy_id));
  const state = await readHealthState(options.stateFile ?? process.env.X_PROXY_POOL_STATE_FILE ?? DEFAULT_STATE_FILE);
  const nowMs = Date.now();
  const stableProxyCount = Object.values(state.proxies ?? {}).filter((entry) => {
    const health = entry.targets?.[TARGET] ?? {};
    return health.first_success_at &&
    health.last_success_at &&
    Date.parse(health.first_success_at) <= nowMs - 10 * 60 * 1000 &&
    Date.parse(health.last_success_at) >= nowMs - 5 * 60 * 1000;
  }
  ).length;
  return {
    upstream: UPSTREAM_PROXY_POOL,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    samples,
    concurrency,
    health_window_size: 20,
    selector: options.strategy ?? "balanced",
    target: TARGET,
    success: successes,
    failed: samples - successes,
    success_rate: samples === 0 ? 1 : successes / samples,
    eligible_proxy_count: proxyIds.size,
    stable_proxy_count: stableProxyCount,
    p50_duration_ms: percentile(0.5),
    p95_duration_ms: percentile(0.95),
    passed: successes / samples >= 0.9 &&
      proxyIds.size >= 5 &&
      stableProxyCount >= 3 &&
      percentile(0.95) !== null &&
      percentile(0.95) <= 10000,
    results,
  };
}

async function validateAllProxies({
  codes = ["1.600519", "0.000001", "0.300750", "1.601318"],
  concurrency = 8,
  limit,
  ...options
} = {}) {
  const fetchCandidates = options.fetchAllCandidatesImpl ?? fetchAllProxyCandidates;
  const requestKline = options.requestKlineImpl ?? requestKlineThroughProxy;
  const recordResult = options.recordResultImpl ?? recordProxyResult;
  const stateFile = options.stateFile ?? process.env.X_PROXY_POOL_STATE_FILE ?? DEFAULT_STATE_FILE;
  const candidates = await fetchCandidates(options);
  const selected = Number.isInteger(limit) ? candidates.slice(0, limit) : candidates;
  const startedAt = new Date().toISOString();
  const results = await mapWithConcurrency(selected, concurrency, async (proxy, index) => {
    const started = Date.now();
    const secid = codes[index % codes.length];
    try {
      const result = await requestKline(proxy, { secid, klt: 101, lmt: 1 }, options);
      const durationMs = Number.isFinite(result.durationMs) ? result.durationMs : Date.now() - started;
      await recordResult(proxy, { ok: true, durationMs }, stateFile);
      return { proxy, proxy_id: proxyId(proxy), ok: true, duration_ms: durationMs, secid };
    } catch (error) {
      const errorClass = classifyProxyError(error);
      const durationMs = Date.now() - started;
      await recordResult(proxy, { ok: false, durationMs, errorClass }, stateFile);
      return {
        proxy,
        proxy_id: proxyId(proxy),
        ok: false,
        duration_ms: durationMs,
        error_class: errorClass,
        error: error.message,
        secid,
      };
    }
  });
  const available = results.filter((item) => item.ok).sort((a, b) => a.duration_ms - b.duration_ms);
  const errorCounts = results.filter((item) => !item.ok).reduce((counts, item) => {
    counts[item.error_class] = (counts[item.error_class] ?? 0) + 1;
    return counts;
  }, {});
  return {
    upstream: UPSTREAM_PROXY_POOL,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    candidate_count: candidates.length,
    health_window_size: 20,
    selector: options.strategy ?? "balanced",
    target: TARGET,
    checked_count: results.length,
    available_count: available.length,
    failed_count: results.length - available.length,
    success_rate: results.length === 0 ? 0 : available.length / results.length,
    error_counts: errorCounts,
    available,
    results,
  };
}

module.exports = {
  DEFAULT_POOL_URL,
  DEFAULT_STATE_FILE,
  UPSTREAM_PROXY_POOL,
  buildKlineUrl,
  classifyProxyError,
  cooldownMs,
  adaptiveTimeouts,
  fetchAllProxyCandidates,
  fetchProxyCandidates,
  getKlineViaProxyPool,
  orderCandidates,
  parseProxyList,
  proxyId,
  readLocalPoolEnv,
  recordProxyResult,
  requestKlineThroughProxy,
  runProxyBenchmark,
  validateAllProxies,
};
