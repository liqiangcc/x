"use strict";

const { normalizeProxy } = require("./model");
const { rankCandidates } = require("./selectors");

class ProxyManager {
  constructor({ healthStore, provider, transport, classifyError }) {
    this.healthStore = healthStore;
    this.provider = provider;
    this.transport = transport;
    this.classifyError = classifyError;
  }

  async execute({ attempts = 3, candidateOptions = {}, probe, strategy = "balanced", ...options }) {
    const candidates = (await this.provider.listCandidates(candidateOptions)).map((proxy) => normalizeProxy(proxy));
    if (candidates.length === 0) throw new Error("Proxy provider returned no valid candidates.");
    const state = await this.healthStore.read();
    const ordered = rankCandidates(candidates, state, { ...options, strategy, target: probe.target });
    const failures = [];
    let attempted = 0;
    for (const proxy of ordered) {
      if (attempted >= attempts) break;
      if (options.acquire && !options.acquire(proxy)) continue;
      attempted += 1;
      const startedAt = Date.now();
      try {
        const adaptiveTimeouts = options.timeoutResolver ? options.timeoutResolver(proxy, state) : {};
        const response = await this.transport(proxy, { ...probe.request, ...adaptiveTimeouts, timeoutMs: options.timeoutMs });
        const payload = probe.validate(response);
        await this.healthStore.record(proxy, probe.target, { ok: true, durationMs: response.durationMs });
        return { payload, proxy, attempts: failures.length + 1, durationMs: Date.now() - startedAt, failures };
      } catch (error) {
        const errorClass = this.classifyError(error);
        await this.healthStore.record(proxy, probe.target, { ok: false, durationMs: Date.now() - startedAt, errorClass });
        failures.push({ proxy_id: proxy.id, error_class: errorClass, error: error.message });
      } finally {
        if (options.release) options.release(proxy);
      }
    }
    const error = new Error(`All proxy attempts failed: ${failures.map((item) => `${item.proxy_id}:${item.error_class}`).join(", ")}`);
    error.failures = failures;
    throw error;
  }
}

module.exports = { ProxyManager };
