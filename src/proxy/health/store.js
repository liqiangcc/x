"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { normalizeProxy } = require("../model");

const STATE_VERSION = 2;
const DEFAULT_WINDOW_SIZE = 20;

function percentile(values, ratio) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

function summarizeSamples(samples) {
  const successes = samples.filter((sample) => sample.ok);
  const latencies = successes.map((sample) => sample.duration_ms).filter(Number.isFinite);
  let ewma = null;
  for (const latency of latencies) ewma = ewma === null ? latency : 0.3 * latency + 0.7 * ewma;
  return {
    sample_count: samples.length,
    success_rate: samples.length === 0 ? 0 : successes.length / samples.length,
    ewma_latency_ms: ewma,
    p50_latency_ms: percentile(latencies, 0.5),
    p95_latency_ms: percentile(latencies, 0.95),
  };
}

function migrateState(raw = {}) {
  if (raw.version === STATE_VERSION) return raw;
  const state = { version: STATE_VERSION, proxies: {} };
  for (const [id, entry] of Object.entries(raw.proxies ?? {})) {
    const proxy = normalizeProxy(entry.proxy ?? entry.endpoint ?? "", { source: "proxypool" });
    if (!proxy.endpoint) continue;
    const samples = [];
    if (entry.last_checked_at) {
      samples.push({
        at: entry.last_checked_at,
        duration_ms: entry.last_latency_ms ?? null,
        error_class: entry.last_error_class ?? null,
        ok: !entry.last_error_class,
      });
    }
    state.proxies[id] = {
      proxy,
      targets: {
        "eastmoney-kline": {
          consecutive_failures: entry.consecutive_failures ?? 0,
          cooldown_until: entry.cooldown_until ?? null,
          first_success_at: entry.first_success_at ?? null,
          last_checked_at: entry.last_checked_at ?? null,
          last_success_at: entry.last_success_at ?? null,
          samples,
          ...summarizeSamples(samples),
        },
      },
    };
  }
  return state;
}

async function readHealthState(stateFile) {
  try {
    return migrateState(JSON.parse(await fs.readFile(stateFile, "utf8")));
  } catch (error) {
    if (error.code === "ENOENT") return { version: STATE_VERSION, proxies: {} };
    throw error;
  }
}

async function withStateLock(stateFile, callback) {
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  const lockFile = `${stateFile}.lock`;
  let handle;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { handle = await fs.open(lockFile, "wx"); break; } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        const stats = await fs.stat(lockFile);
        if (Date.now() - stats.mtimeMs > 30_000) { await fs.rm(lockFile, { force: true }); continue; }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  if (!handle) throw new Error("Timed out acquiring proxy health state lock.");
  try { return await callback(); } finally {
    await handle.close();
    await fs.rm(lockFile, { force: true });
  }
}

class JsonHealthStore {
  constructor({ stateFile, windowSize = DEFAULT_WINDOW_SIZE, cooldownForError }) {
    this.stateFile = stateFile;
    this.windowSize = windowSize;
    this.cooldownForError = cooldownForError;
  }

  read() { return readHealthState(this.stateFile); }

  async record(proxyValue, target, result) {
    const proxy = normalizeProxy(proxyValue);
    return withStateLock(this.stateFile, async () => {
      const state = await this.read();
      const previous = state.proxies[proxy.id]?.targets?.[target] ?? { samples: [] };
      const now = new Date().toISOString();
      const sample = {
        at: now,
        duration_ms: Number.isFinite(result.durationMs) ? result.durationMs : null,
        error_class: result.ok ? null : result.errorClass,
        ok: Boolean(result.ok),
      };
      const samples = [...(previous.samples ?? []), sample].slice(-this.windowSize);
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
      state.proxies[proxy.id] = {
        proxy,
        targets: { ...(state.proxies[proxy.id]?.targets ?? {}), [target]: targetState },
      };
      const tempFile = `${this.stateFile}.${process.pid}.tmp`;
      await fs.writeFile(tempFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
      await fs.rename(tempFile, this.stateFile);
      return targetState;
    });
  }
}

module.exports = { DEFAULT_WINDOW_SIZE, JsonHealthStore, migrateState, readHealthState, summarizeSamples };
