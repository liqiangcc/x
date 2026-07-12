"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { readHealthState } = require("./health/store");

const TARGET = "eastmoney-kline";

function selectHealthyProxies(state, options = {}) {
  const minSamples = Number(options.minSamples ?? 5);
  const minSuccessRate = Number(options.minSuccessRate ?? 0.8);
  const maxP95Ms = Number(options.maxP95Ms ?? 3000);
  const limit = Number(options.limit ?? 5);
  const rows = Object.values(state.proxies ?? {}).map((entry) => {
    const health = entry.targets?.[TARGET] ?? {};
    return {
      endpoint: entry.proxy?.endpoint,
      protocol: entry.proxy?.protocol ?? "http",
      region: entry.proxy?.region ?? "CN",
      samples: Number(health.sample_count ?? 0),
      success_rate: Number(health.success_rate ?? 0),
      p50_ms: health.p50_latency_ms ?? null,
      p95_ms: health.p95_latency_ms ?? null,
      ewma_ms: health.ewma_latency_ms ?? null,
      last_success_at: health.last_success_at ?? null,
    };
  }).filter((row) => row.endpoint && row.samples >= minSamples &&
    row.success_rate >= minSuccessRate && Number.isFinite(row.p95_ms) && row.p95_ms <= maxP95Ms);
  return rows.sort((left, right) => right.success_rate - left.success_rate ||
    left.p95_ms - right.p95_ms || left.ewma_ms - right.ewma_ms).slice(0, limit);
}

async function writeSelectedProxies({ stateFile, outputFile, ...options }) {
  const state = await readHealthState(stateFile);
  const proxies = selectHealthyProxies(state, options);
  if (proxies.length === 0) {
    try {
      const previous = JSON.parse(await fs.readFile(outputFile, "utf8"));
      return { ...previous, retained_previous: true, selected_count: previous.proxies?.length ?? 0 };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const report = {
    generated_at: new Date().toISOString(),
    target: TARGET,
    policy: {
      min_samples: Number(options.minSamples ?? 5),
      min_success_rate: Number(options.minSuccessRate ?? 0.8),
      max_p95_ms: Number(options.maxP95Ms ?? 3000),
      limit: Number(options.limit ?? 5),
    },
    selected_count: proxies.length,
    retained_previous: false,
    proxies,
  };
  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  const tempFile = `${outputFile}.${process.pid}.tmp`;
  await fs.writeFile(tempFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.rename(tempFile, outputFile);
  return report;
}

module.exports = { selectHealthyProxies, writeSelectedProxies };
