"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  classifyProxyError,
  fetchAllProxyCandidates,
  fetchProxyCandidates,
  getKlineViaProxyPool,
  orderCandidates,
  parseProxyList,
  proxyId,
  requestKlineThroughProxy,
} = require("../src/proxy/pool");
const { resolveKline } = require("../fetch/fetch_kline");

test("parseProxyList accepts unique valid IPv4 proxies", () => {
  assert.deepEqual(
    parseProxyList("1.2.3.4:80\n1.2.3.4:80 bad 999.2.3.4:80 5.6.7.8:65536\n8.8.8.8:8080"),
    ["1.2.3.4:80", "8.8.8.8:8080"]
  );
});

test("fetchProxyCandidates requests CN proxies with API authentication", async () => {
  let captured;
  const candidates = await fetchProxyCandidates({
    apiKey: "secret",
    count: 2,
    poolUrl: "http://pool.test:5555",
    fetchImpl: async (url, request) => {
      captured = { url: String(url), request };
      return new Response("1.2.3.4:80\n5.6.7.8:8080", { status: 200 });
    },
  });
  assert.deepEqual(candidates, ["1.2.3.4:80", "5.6.7.8:8080"]);
  assert.match(captured.url, /area=CN/);
  assert.match(captured.url, /count=2/);
  assert.equal(captured.request.headers["API-KEY"], "secret");
});

test("fetchAllProxyCandidates treats an empty CN pool as a healthy response", async () => {
  let requestedUrl;
  const candidates = await fetchAllProxyCandidates({
    apiKey: "secret",
    poolUrl: "http://pool.test:5555",
    fetchImpl: async (url) => {
      requestedUrl = String(url);
      return new Response("", { status: 200 });
    },
  });
  assert.deepEqual(candidates, []);
  assert.match(requestedUrl, /\/all\?area=CN/);
});

test("orderCandidates excludes cooling proxies and prefers proven low latency", () => {
  const cooling = "1.1.1.1:80";
  const fast = "2.2.2.2:80";
  const slow = "3.3.3.3:80";
  const state = {
    proxies: {
      [proxyId(cooling)]: { cooldown_until: "2099-01-01T00:00:00.000Z" },
      [proxyId(fast)]: { success_count: 2, last_latency_ms: 20 },
      [proxyId(slow)]: { success_count: 2, last_latency_ms: 200 },
    },
  };
  assert.deepEqual(orderCandidates([cooling, slow, fast], state, Date.now(), () => 0.999), [fast, slow]);
});

test("getKlineViaProxyPool rotates after failure and exposes only a proxy id", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "x-proxy-pool-"));
  const stateFile = path.join(dir, "health.json");
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const calls = [];
  const payload = await getKlineViaProxyPool(
    { secid: "1.600519", klt: 101, lmt: 1 },
    {
      stateFile,
      maxAttempts: 2,
      random: () => 0.999,
      fetchCandidatesImpl: async () => ["1.1.1.1:80", "2.2.2.2:80"],
      requestKlineImpl: async (proxy) => {
        calls.push(proxy);
        if (proxy === "1.1.1.1:80") {
          throw new Error("request timeout");
        }
        return {
          durationMs: 15,
          payload: { data: { code: "600519", market: 1, klines: ["2026-07-10,1,1,1,1,1"] } },
        };
      },
    }
  );
  assert.deepEqual(calls, ["1.1.1.1:80", "2.2.2.2:80"]);
  assert.equal(payload.source_engine, "proxy-pool");
  assert.equal(payload.proxy_attempts, 2);
  assert.equal(payload.proxy_id, proxyId("2.2.2.2:80"));
  assert.equal(JSON.stringify(payload).includes("2.2.2.2:80"), false);
});

test("classifyProxyError distinguishes policy, TLS, and transient failures", () => {
  assert.equal(classifyProxyError(new Error("HTTP 429")), "rate_limited");
  assert.equal(classifyProxyError(new Error("certificate expired")), "tls_error");
  assert.equal(classifyProxyError(new Error("request timeout")), "timeout");
});

test("requestKlineThroughProxy keeps TLS verification enabled", async () => {
  let agentConfig;
  let closed = false;
  const result = await requestKlineThroughProxy("1.2.3.4:8080", {
    secid: "1.600519",
    klt: 101,
    lmt: 1,
  }, {
    proxyAgentFactory: (config) => {
      agentConfig = config;
      return { close: async () => { closed = true; } };
    },
    requestImpl: async (_url, requestOptions) => {
      assert.ok(requestOptions.dispatcher);
      return {
        statusCode: 200,
        body: {
          text: async () => JSON.stringify({
            data: { code: "600519", market: 1, klines: ["2026-07-10,1,1,1,1,1"] },
          }),
        },
      };
    },
  });

  assert.equal(agentConfig.requestTls.rejectUnauthorized, true);
  assert.equal(result.payload.data.klines.length, 1);
  assert.equal(closed, true);
});

test("resolveKline supports the explicit proxy-pool engine", async () => {
  const result = await resolveKline(
    { input: "600519", period: "daily", engine: "proxy-pool" },
    {
      fetchProxyPoolKline: async () => ({
        source_engine: "proxy-pool",
        source_region: "CN",
        data: { code: "600519", market: 1, klines: ["2026-07-10,1,1,1,1,1"] },
      }),
    }
  );
  assert.equal(result.source_engine, "proxy-pool");
  assert.equal(result.data.klines.length, 1);
});
