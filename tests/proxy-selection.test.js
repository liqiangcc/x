"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildProxySelectionReport,
  retainPreviousProxySelection,
  selectHealthyProxies,
} = require("../src/proxy/selection");

function entry(endpoint, samples, successRate, p95, ewma = p95) {
  return { proxy: { endpoint }, targets: { "eastmoney-kline": {
    sample_count: samples, success_rate: successRate, p50_latency_ms: 100,
    p95_latency_ms: p95, ewma_latency_ms: ewma, last_success_at: "2026-07-12T00:00:00Z",
  } } };
}

test("selectHealthyProxies filters thresholds and ranks reliability before latency", () => {
  const state = { version: 2, proxies: {
    a: entry("1.1.1.1:80", 10, 0.9, 500),
    b: entry("2.2.2.2:80", 10, 1, 900),
    c: entry("3.3.3.3:80", 2, 1, 100),
  } };
  assert.deepEqual(selectHealthyProxies(state, { minSamples: 5, minSuccessRate: 0.8, maxP95Ms: 1000, limit: 2 })
    .map((row) => row.endpoint), ["2.2.2.2:80", "1.1.1.1:80"]);
});

test("proxy selection report construction remains deterministic", () => {
  const proxies = [{ endpoint: "1.1.1.1:80" }];
  assert.deepEqual(buildProxySelectionReport({
    generatedAt: "2026-08-15T00:00:00Z",
    options: { minSamples: 6, minSuccessRate: 0.9, maxP95Ms: 2500, limit: 3 },
    proxies,
  }), {
    generated_at: "2026-08-15T00:00:00Z",
    target: "eastmoney-kline",
    policy: {
      min_samples: 6,
      min_success_rate: 0.9,
      max_p95_ms: 2500,
      limit: 3,
    },
    selected_count: 1,
    retained_previous: false,
    proxies,
  });
});

test("retaining a previous selection changes only retention metadata", () => {
  const previous = {
    generated_at: "2026-08-14T00:00:00Z",
    target: "eastmoney-kline",
    policy: { min_samples: 5 },
    selected_count: 1,
    retained_previous: false,
    proxies: [{ endpoint: "1.1.1.1:80" }],
  };
  assert.deepEqual(retainPreviousProxySelection(previous), {
    ...previous,
    retained_previous: true,
    selected_count: 1,
  });
});
