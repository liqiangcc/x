"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { ProxyAgent, request } = require("undici");
const { parseJsonOrJsonp } = require("../core/jsonp");

const ROOT = path.resolve(__dirname, "../..");
const DEFAULT_POOL_URL = "http://127.0.0.1:5555";
const DEFAULT_STATE_FILE = path.join(ROOT, "var/proxy-pool/ttjj-health.json");
const DEFAULT_ENV_FILE = path.join(ROOT, "ops/proxy-pool/.env");
const EASTMONEY_HOSTS = new Set(["push2his.eastmoney.com"]);
const UPSTREAM_PROXY_POOL = {
  repository: "https://github.com/Python3WebSpider/ProxyPool",
  commit: "cabcd96cc9f30d7bdbc872bb8a8c52760023c142",
  license: "MIT",
};
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";

function proxyId(proxy) {
  return crypto.createHash("sha256").update(proxy).digest("hex").slice(0, 12);
}

function parseProxyList(text) {
  return [...new Set(String(text ?? "")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => /^(?:\d{1,3}\.){3}\d{1,3}:\d{1,5}$/.test(item))
    .filter((item) => {
      const [host, portText] = item.split(":");
      const octetsValid = host.split(".").every((octet) => Number(octet) >= 0 && Number(octet) <= 255);
      const port = Number(portText);
      return octetsValid && Number.isInteger(port) && port >= 1 && port <= 65535;
    }))];
}

function buildKlineUrl({ secid = "1.600519", klt = 101, lmt = 1, end = "20991231" } = {}) {
  const url = new URL("https://push2his.eastmoney.com/api/qt/stock/kline/get");
  url.searchParams.set("secid", String(secid));
  url.searchParams.set("ut", "fa5fd1943c7b386f172d6893dbfba10b");
  url.searchParams.set("fields1", "f1,f2,f3,f4,f5,f6");
  url.searchParams.set("fields2", "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61");
  url.searchParams.set("klt", String(klt));
  url.searchParams.set("fqt", "1");
  url.searchParams.set("end", String(end));
  url.searchParams.set("lmt", String(lmt));
  url.searchParams.set("_", String(Date.now()));
  return url.toString();
}

function defaultHeaders() {
  return {
    Accept: "*/*",
    "Accept-Language": "zh-CN,zh;q=0.9",
    Referer: "https://quote.eastmoney.com/",
    "User-Agent": USER_AGENT,
  };
}

async function readLocalPoolEnv(envFile = DEFAULT_ENV_FILE) {
  try {
    const content = await fs.readFile(envFile, "utf8");
    return Object.fromEntries(content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
      }));
  } catch (error) {
    if (error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function fetchProxyCandidates({
  apiKey = process.env.X_PROXY_POOL_API_KEY ?? process.env.PROXY_POOL_API_KEY ?? "",
  count = 50,
  fetchImpl = fetch,
  poolUrl = process.env.X_PROXY_POOL_URL ?? DEFAULT_POOL_URL,
} = {}) {
  const localEnv = apiKey ? {} : await readLocalPoolEnv();
  apiKey = apiKey || localEnv.PROXY_POOL_API_KEY || "";
  if (poolUrl === DEFAULT_POOL_URL && localEnv.PROXY_POOL_PORT) {
    poolUrl = `http://127.0.0.1:${localEnv.PROXY_POOL_PORT}`;
  }
  const url = new URL("/random", `${String(poolUrl).replace(/\/+$/, "")}/`);
  url.searchParams.set("area", "CN");
  url.searchParams.set("count", String(count));
  const response = await fetchImpl(url, {
    headers: apiKey ? { "API-KEY": apiKey } : {},
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    if (response.status === 500) {
      const countUrl = new URL("/count", `${String(poolUrl).replace(/\/+$/, "")}/`);
      const countResponse = await fetchImpl(countUrl, {
        headers: apiKey ? { "API-KEY": apiKey } : {},
        signal: AbortSignal.timeout(5000),
      });
      if (countResponse.ok && Number(await countResponse.text()) === 0) {
        return [];
      }
    }
    throw new Error(`ProxyPool API returned HTTP ${response.status}`);
  }
  return parseProxyList(await response.text());
}

async function fetchAllProxyCandidates({
  apiKey = process.env.X_PROXY_POOL_API_KEY ?? process.env.PROXY_POOL_API_KEY ?? "",
  fetchImpl = fetch,
  poolUrl = process.env.X_PROXY_POOL_URL ?? DEFAULT_POOL_URL,
} = {}) {
  const localEnv = apiKey ? {} : await readLocalPoolEnv();
  apiKey = apiKey || localEnv.PROXY_POOL_API_KEY || "";
  if (poolUrl === DEFAULT_POOL_URL && localEnv.PROXY_POOL_PORT) {
    poolUrl = `http://127.0.0.1:${localEnv.PROXY_POOL_PORT}`;
  }
  const url = new URL("/all", `${String(poolUrl).replace(/\/+$/, "")}/`);
  url.searchParams.set("area", "CN");
  const response = await fetchImpl(url, {
    headers: apiKey ? { "API-KEY": apiKey } : {},
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    if (response.status === 500) {
      const countUrl = new URL("/count", `${String(poolUrl).replace(/\/+$/, "")}/`);
      const countResponse = await fetchImpl(countUrl, {
        headers: apiKey ? { "API-KEY": apiKey } : {},
        signal: AbortSignal.timeout(5000),
      });
      if (countResponse.ok && Number(await countResponse.text()) === 0) {
        return [];
      }
    }
    throw new Error(`ProxyPool API returned HTTP ${response.status}`);
  }
  return parseProxyList(await response.text());
}

function classifyProxyError(error) {
  const message = String(error?.message ?? error ?? "");
  if (/HTTP 429|Too Many Requests/i.test(message)) {
    return "rate_limited";
  }
  if (/HTTP 403|Forbidden/i.test(message)) {
    return "forbidden";
  }
  if (/certificate|CERT_|TLS|SSL/i.test(message)) {
    return "tls_error";
  }
  if (/timeout|timed out|AbortError|UND_ERR_CONNECT_TIMEOUT/i.test(message)) {
    return "timeout";
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

async function requestKlineThroughProxy(proxy, input = {}, options = {}) {
  const urlText = buildKlineUrl(input);
  const url = new URL(urlText);
  if (!EASTMONEY_HOSTS.has(url.hostname)) {
    throw new Error(`Proxy target host is not allowed: ${url.hostname}`);
  }

  const proxyAgentFactory = options.proxyAgentFactory ?? ((config) => new ProxyAgent(config));
  const requestImpl = options.requestImpl ?? request;
  const dispatcher = proxyAgentFactory({
    uri: `http://${proxy}`,
    requestTls: { rejectUnauthorized: true },
  });
  const startedAt = Date.now();
  try {
    const response = await requestImpl(urlText, {
      dispatcher,
      headers: defaultHeaders(),
      headersTimeout: options.timeoutMs ?? 6000,
      bodyTimeout: options.timeoutMs ?? 6000,
      maxRedirections: 0,
      method: "GET",
    });
    const rawText = await response.body.text();
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`Eastmoney proxy HTTP ${response.statusCode}: ${rawText.slice(0, 160)}`);
    }
    let payload;
    try {
      payload = parseJsonOrJsonp(rawText);
    } catch (error) {
      throw new Error(`Eastmoney proxy returned invalid JSON: ${error.message}`);
    }
    if (!Array.isArray(payload?.data?.klines) || payload.data.klines.length === 0) {
      throw new Error("Eastmoney proxy response missing data.klines or returned empty data.");
    }
    return {
      payload,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    await dispatcher.close();
  }
}

async function readHealthState(stateFile = DEFAULT_STATE_FILE) {
  try {
    return JSON.parse(await fs.readFile(stateFile, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return { version: 1, proxies: {} };
    }
    throw error;
  }
}

async function withStateLock(stateFile, callback) {
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  const lockFile = `${stateFile}.lock`;
  let handle;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      handle = await fs.open(lockFile, "wx");
      break;
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
      try {
        const stats = await fs.stat(lockFile);
        if (Date.now() - stats.mtimeMs > 30_000) {
          await fs.rm(lockFile, { force: true });
          continue;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  if (!handle) {
    throw new Error("Timed out acquiring proxy health state lock.");
  }
  try {
    return await callback();
  } finally {
    await handle.close();
    await fs.rm(lockFile, { force: true });
  }
}

async function recordProxyResult(proxy, result, stateFile = DEFAULT_STATE_FILE) {
  return withStateLock(stateFile, async () => {
    const state = await readHealthState(stateFile);
    const id = proxyId(proxy);
    const previous = state.proxies[id] ?? {};
    const now = new Date().toISOString();
    const success = Boolean(result.ok);
    state.proxies[id] = {
      proxy,
      success_count: Number(previous.success_count ?? 0) + (success ? 1 : 0),
      failure_count: Number(previous.failure_count ?? 0) + (success ? 0 : 1),
      consecutive_failures: success ? 0 : Number(previous.consecutive_failures ?? 0) + 1,
      last_error_class: success ? null : result.errorClass,
      last_latency_ms: Number.isFinite(result.durationMs) ? result.durationMs : previous.last_latency_ms ?? null,
      last_checked_at: now,
      first_success_at: success ? previous.first_success_at ?? now : previous.first_success_at ?? null,
      last_success_at: success ? now : previous.last_success_at ?? null,
      cooldown_until: success
        ? null
        : new Date(Date.now() + cooldownMs(result.errorClass)).toISOString(),
    };
    const retentionCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const [storedId, stored] of Object.entries(state.proxies)) {
      if (storedId !== id && Date.parse(stored.last_checked_at ?? 0) < retentionCutoff) {
        delete state.proxies[storedId];
      }
    }
    const tempFile = `${stateFile}.${process.pid}.tmp`;
    await fs.writeFile(tempFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await fs.rename(tempFile, stateFile);
    return state.proxies[id];
  });
}

function orderCandidates(candidates, state, nowMs = Date.now(), random = Math.random) {
  const ranked = candidates
    .filter((proxy) => {
      const entry = state.proxies?.[proxyId(proxy)];
      return !entry?.cooldown_until || Date.parse(entry.cooldown_until) <= nowMs;
    })
    .map((proxy) => ({ proxy, state: state.proxies?.[proxyId(proxy)] ?? {} }))
    .sort((left, right) => {
      const successDifference = Number(right.state.success_count ?? 0) - Number(left.state.success_count ?? 0);
      if (successDifference !== 0) {
        return successDifference;
      }
      return Number(left.state.last_latency_ms ?? Number.MAX_SAFE_INTEGER) -
        Number(right.state.last_latency_ms ?? Number.MAX_SAFE_INTEGER);
    });
  const preferred = ranked.slice(0, 20);
  for (let index = preferred.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [preferred[index], preferred[swapIndex]] = [preferred[swapIndex], preferred[index]];
  }
  return [...preferred, ...ranked.slice(20)].map((item) => item.proxy);
}

async function getKlineViaProxyPool(input, options = {}) {
  const stateFile = options.stateFile ?? process.env.X_PROXY_POOL_STATE_FILE ?? DEFAULT_STATE_FILE;
  const fetchCandidates = options.fetchCandidatesImpl ?? fetchProxyCandidates;
  const requestKline = options.requestKlineImpl ?? requestKlineThroughProxy;
  const recordResult = options.recordResultImpl ?? recordProxyResult;
  const candidates = await fetchCandidates(options);
  if (candidates.length === 0) {
    throw new Error("ProxyPool returned no valid CN proxy candidates.");
  }
  const state = await readHealthState(stateFile);
  const ordered = orderCandidates(candidates, state, Date.now(), options.random ?? Math.random);
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
  const stableProxyCount = Object.values(state.proxies ?? {}).filter((entry) =>
    entry.first_success_at &&
    entry.last_success_at &&
    Date.parse(entry.first_success_at) <= nowMs - 10 * 60 * 1000 &&
    Date.parse(entry.last_success_at) >= nowMs - 5 * 60 * 1000
  ).length;
  return {
    upstream: UPSTREAM_PROXY_POOL,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    samples,
    concurrency,
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

module.exports = {
  DEFAULT_POOL_URL,
  DEFAULT_STATE_FILE,
  UPSTREAM_PROXY_POOL,
  buildKlineUrl,
  classifyProxyError,
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
};
