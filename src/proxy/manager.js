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
    const failures = [];
    const attemptedIds = new Set();
    const leaseWaitMs = Number(options.leaseWaitMs ?? 30_000);
    const leasePollMs = Number(options.leasePollMs ?? 25);
    const leaseDeadline = Date.now() + leaseWaitMs;
    let attempted = 0;

    while (attempted < attempts) {
      const state = await this.healthStore.read();
      const ordered = rankCandidates(candidates, state, { ...options, strategy, target: probe.target })
        .filter((proxy) => !attemptedIds.has(proxy.id));
      if (ordered.length === 0) {
        if (options.acquire && attemptedIds.size < candidates.length && Date.now() < leaseDeadline) {
          await new Promise((resolve) => setTimeout(resolve, leasePollMs));
          continue;
        }
        break;
      }
      const proxy = ordered.find((candidate) => !options.acquire || options.acquire(candidate));
      if (!proxy) {
        if (Date.now() >= leaseDeadline) {
          const error = new Error(`Healthy proxy candidates remained busy for ${leaseWaitMs}ms.`);
          error.code = "proxy_busy_timeout";
          error.failures = failures;
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, leasePollMs));
        continue;
      }

      attemptedIds.add(proxy.id);
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
    if (failures.length === 0) {
      const error = new Error(`No healthy proxy candidates are currently available (${candidates.length} checked).`);
      error.code = "proxy_unavailable";
      error.failures = failures;
      throw error;
    }
    const error = new Error(`All proxy attempts failed: ${failures.map((item) => `${item.proxy_id}:${item.error_class}`).join(", ")}`);
    error.failures = failures;
    throw error;
  }
}

module.exports = { ProxyManager };
