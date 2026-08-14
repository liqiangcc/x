"use strict";

const TARGET = "eastmoney-kline";

function proxySelectionPolicy(options = {}) {
  return {
    min_samples: Number(options.minSamples ?? 5),
    min_success_rate: Number(options.minSuccessRate ?? 0.8),
    max_p95_ms: Number(options.maxP95Ms ?? 3000),
    limit: Number(options.limit ?? 5),
  };
}

function selectHealthyProxies(state, options = {}) {
  const policy = proxySelectionPolicy(options);
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
  }).filter((row) => row.endpoint && row.samples >= policy.min_samples &&
    row.success_rate >= policy.min_success_rate && Number.isFinite(row.p95_ms) && row.p95_ms <= policy.max_p95_ms);
  return rows.sort((left, right) => right.success_rate - left.success_rate ||
    left.p95_ms - right.p95_ms || left.ewma_ms - right.ewma_ms).slice(0, policy.limit);
}

function buildProxySelectionReport({ generatedAt, options = {}, proxies = [] } = {}) {
  return {
    generated_at: generatedAt,
    target: TARGET,
    policy: proxySelectionPolicy(options),
    selected_count: proxies.length,
    retained_previous: false,
    proxies,
  };
}

function retainPreviousProxySelection(previous = {}) {
  return {
    ...previous,
    retained_previous: true,
    selected_count: previous.proxies?.length ?? 0,
  };
}

module.exports = {
  TARGET,
  buildProxySelectionReport,
  proxySelectionPolicy,
  retainPreviousProxySelection,
  selectHealthyProxies,
};
