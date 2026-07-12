"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { DEFAULT_WINDOW_SIZE, readHealthState, summarizeSamples } = require("./health/store");
const { ProxyPoolProvider } = require("./providers/proxypool");
const { createEastmoneyKlineProbe, TARGET } = require("./probes/eastmoney_kline");
const { ProxyTransportSession } = require("./transport/http_proxy");

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      results[current] = await mapper(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

function percentile(values, ratio) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

class BufferedHealthStore {
  constructor({ cooldownForError, stateFile, windowSize = DEFAULT_WINDOW_SIZE }) {
    this.cooldownForError = cooldownForError;
    this.stateFile = stateFile;
    this.windowSize = windowSize;
    this.state = null;
  }

  async read() {
    this.state ??= await readHealthState(this.stateFile);
    return this.state;
  }

  async record(proxy, target, result) {
    const state = await this.read();
    const previous = state.proxies[proxy.id]?.targets?.[target] ?? { samples: [] };
    const now = new Date().toISOString();
    const samples = [...previous.samples, {
      at: now,
      duration_ms: Number.isFinite(result.durationMs) ? result.durationMs : null,
      error_class: result.ok ? null : result.errorClass,
      ok: Boolean(result.ok),
    }].slice(-this.windowSize);
    const targetState = {
      ...previous,
      ...summarizeSamples(samples),
      samples,
      consecutive_failures: result.ok ? 0 : Number(previous.consecutive_failures ?? 0) + 1,
      cooldown_until: result.ok ? null : new Date(Date.now() + this.cooldownForError(result.errorClass)).toISOString(),
      first_success_at: result.ok ? previous.first_success_at ?? now : previous.first_success_at ?? null,
      last_checked_at: now,
      last_error_class: result.ok ? null : result.errorClass,
      last_success_at: result.ok ? now : previous.last_success_at ?? null,
    };
    state.proxies[proxy.id] = { proxy, targets: { ...(state.proxies[proxy.id]?.targets ?? {}), [target]: targetState } };
    return targetState;
  }

  async flush() {
    if (!this.state) return;
    await fs.mkdir(path.dirname(this.stateFile), { recursive: true });
    const temp = `${this.stateFile}.${process.pid}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(this.state, null, 2)}\n`, "utf8");
    await fs.rename(temp, this.stateFile);
  }
}

class ProxyBatchRuntime {
  constructor({ classifyError, cooldownForError, stateFile, ...options }) {
    this.classifyError = classifyError;
    this.options = options;
    this.provider = new ProxyPoolProvider({ ...options, all: true });
    this.healthStore = new BufferedHealthStore({ cooldownForError, stateFile });
    this.transport = new ProxyTransportSession(options);
    this.candidates = null;
    this.available = null;
    this.preflightReport = null;
    this.leased = new Set();
  }

  async prepare({ concurrency = 16, minAvailable = 5, minSuccessRate = 0.6, timeoutMs = 3000 } = {}) {
    this.candidates = await this.provider.listCandidates({ all: true });
    const results = await mapWithConcurrency(this.candidates, concurrency, async (proxy, index) => {
      const probe = createEastmoneyKlineProbe({ secid: ["1.600519", "0.000001", "0.300750", "1.601318"][index % 4], lmt: 1 });
      const started = Date.now();
      try {
        const response = await this.transport.request(proxy, { ...probe.request, timeoutMs });
        probe.validate(response);
        await this.healthStore.record(proxy, TARGET, { ok: true, durationMs: response.durationMs });
        return { ok: true, proxy, duration_ms: response.durationMs };
      } catch (error) {
        const errorClass = this.classifyError(error);
        await this.healthStore.record(proxy, TARGET, { ok: false, durationMs: Date.now() - started, errorClass });
        return { ok: false, proxy, error_class: errorClass };
      }
    });
    this.available = results.filter((item) => item.ok).map((item) => item.proxy);
    const durations = results.filter((item) => item.ok).map((item) => item.duration_ms);
    const successRate = results.length === 0 ? 0 : this.available.length / results.length;
    this.preflightReport = {
      candidate_count: results.length,
      available_count: this.available.length,
      success_rate: successRate,
      passed: this.available.length >= minAvailable && successRate >= minSuccessRate,
      p50_duration_ms: percentile(durations, 0.5),
      p95_duration_ms: percentile(durations, 0.95),
    };
    if (!this.preflightReport.passed) {
      throw new Error(`Proxy preflight failed: available=${this.available.length}/${minAvailable}, success_rate=${successRate.toFixed(3)}/${minSuccessRate}`);
    }
    return this.preflightReport;
  }

  listCandidates() { return this.available ?? this.candidates ?? []; }

  acquire(proxy) {
    if (this.leased.has(proxy.id)) return false;
    this.leased.add(proxy.id);
    return true;
  }

  release(proxy) { this.leased.delete(proxy.id); }

  async close() {
    await this.healthStore.flush();
    await this.transport.close();
  }
}

module.exports = { BufferedHealthStore, ProxyBatchRuntime, mapWithConcurrency };
