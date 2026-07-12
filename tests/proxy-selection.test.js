"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { selectHealthyProxies, writeSelectedProxies } = require("../src/proxy/selection");

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

test("writeSelectedProxies retains previous non-empty list when no proxy qualifies", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "proxy-select-"));
  const stateFile = path.join(dir, "health.json");
  const outputFile = path.join(dir, "selected.json");
  await fs.writeFile(stateFile, JSON.stringify({ version: 2, proxies: {} }));
  await fs.writeFile(outputFile, JSON.stringify({ proxies: [{ endpoint: "1.1.1.1:80" }] }));
  const report = await writeSelectedProxies({ stateFile, outputFile });
  assert.equal(report.retained_previous, true);
  assert.equal(report.selected_count, 1);
});
