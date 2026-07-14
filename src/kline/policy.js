"use strict";

const BUILTIN_POLICIES = {
  auto: { engines: ["huaweicloud", "aws", "local"] },
  "cn-proxy-only": { engines: [{ name: "proxy-pool", attempts: 1, maxAttempts: 2, selector: "reliable-fastest", timeoutMs: 3000 }] },
  "cloud-first": { engines: ["huaweicloud", "aws", "proxy-pool", "local"] },
  "proxy-first": { engines: ["proxy-pool", "huaweicloud", "aws", "local"] },
  "proxy-only": { engines: ["proxy-pool"] },
};

function normalizePolicy(name, policies = {}) {
  const raw = policies[name] ?? BUILTIN_POLICIES[name];
  if (!raw || !Array.isArray(raw.engines) || raw.engines.length === 0) throw new Error(`Unknown or empty Kline policy: ${name}`);
  return {
    name,
    engines: raw.engines.map((entry) => typeof entry === "string" ? { name: entry, attempts: 1 } : {
      attempts: 1,
      ...entry,
      name: entry.name ?? entry.engine,
    }),
  };
}

async function executePolicy(policy, executors) {
  const failures = [];
  for (const entry of policy.engines) {
    const engine = executors[entry.name];
    if (!engine) throw new Error(`Kline policy ${policy.name} references unknown engine: ${entry.name}`);
    const execute = typeof engine === "function" ? engine : engine.fetchKline.bind(engine);
    let lastError;
    for (let attempt = 1; attempt <= entry.attempts; attempt += 1) {
      try {
        const payload = await execute(entry);
        return { ...payload, source_policy: policy.name, policy_failures: failures };
      } catch (error) { lastError = error; }
    }
    failures.push({ engine: entry.name, error: lastError?.message ?? "unknown error" });
  }
  const error = new Error(`Kline policy ${policy.name} failed: ${failures.map((item) => `${item.engine}: ${item.error}`).join(" | ")}`);
  error.failures = failures;
  throw error;
}

module.exports = { BUILTIN_POLICIES, executePolicy, normalizePolicy };
