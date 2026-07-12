"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { migrateState, summarizeSamples } = require("../src/proxy/health/store");
const { normalizeProxy } = require("../src/proxy/model");
const { rankCandidates } = require("../src/proxy/selectors");
const { adaptiveTimeouts } = require("../src/proxy/pool");

test("health v1 migrates into target-scoped v2 state", () => {
  const state = migrateState({ version: 1, proxies: { abc: {
    proxy: "1.2.3.4:80",
    last_checked_at: "2026-07-12T00:00:00.000Z",
    last_latency_ms: 120,
    first_success_at: "2026-07-12T00:00:00.000Z",
    last_success_at: "2026-07-12T00:00:00.000Z",
  } } });
  assert.equal(state.version, 2);
  assert.equal(state.proxies.abc.proxy.endpoint, "1.2.3.4:80");
  assert.equal(state.proxies.abc.targets["eastmoney-kline"].sample_count, 1);
});

test("health summaries use a bounded recent sample window input", () => {
  const summary = summarizeSamples([
    { ok: true, duration_ms: 100 },
    { ok: false, duration_ms: 200 },
    { ok: true, duration_ms: 300 },
  ]);
  assert.equal(summary.success_rate, 2 / 3);
  assert.equal(summary.p50_latency_ms, 100);
  assert.equal(summary.p95_latency_ms, 300);
});

test("selectors isolate health by target and support fastest and reliable policies", () => {
  const fast = normalizeProxy("1.1.1.1:80");
  const reliable = normalizeProxy("2.2.2.2:80");
  const state = { version: 2, proxies: {
    [fast.id]: { targets: { target: { ewma_latency_ms: 20, success_rate: 0.5 } } },
    [reliable.id]: { targets: { target: { ewma_latency_ms: 200, success_rate: 1 } } },
  } };
  assert.equal(rankCandidates([reliable, fast], state, { strategy: "fastest", target: "target" })[0].id, fast.id);
  assert.equal(rankCandidates([fast, reliable], state, { strategy: "reliable", target: "target" })[0].id, reliable.id);
});

test("adaptive response timeout is clamped between two and ten seconds", () => {
  const proxy = normalizeProxy("1.1.1.1:80");
  const state = { proxies: { [proxy.id]: { targets: { "eastmoney-kline": { p95_latency_ms: 100 } } } } };
  assert.equal(adaptiveTimeouts(proxy, state).headersTimeoutMs, 2000);
  state.proxies[proxy.id].targets["eastmoney-kline"].p95_latency_ms = 10000;
  assert.equal(adaptiveTimeouts(proxy, state).headersTimeoutMs, 10000);
  assert.equal(adaptiveTimeouts(proxy, state, { headersTimeoutMs: 10000 }).headersTimeoutMs, 10000);
  assert.equal(adaptiveTimeouts(proxy, state, { full: true }).bodyTimeoutMs, 6000);
});

test("reliable-fastest prefers eligible low-P95 proxies", () => {
  const fast = normalizeProxy("3.3.3.3:80");
  const slow = normalizeProxy("4.4.4.4:80");
  const now = Date.now();
  const health = (p95) => ({ sample_count: 4, success_rate: 0.75, p95_latency_ms: p95, last_success_at: new Date(now).toISOString() });
  const state = { proxies: {
    [fast.id]: { targets: { target: health(300) } },
    [slow.id]: { targets: { target: health(2000) } },
  } };
  assert.equal(rankCandidates([slow, fast], state, { nowMs: now, strategy: "reliable-fastest", target: "target" })[0].id, fast.id);
});
