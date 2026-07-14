"use strict";

const crypto = require("node:crypto");
const { classifyProxyError, cooldownMs, DEFAULT_STATE_FILE } = require("../../proxy/pool");
const { GithubProxyRepositoryProvider } = require("../../proxy/providers/github_repository");
const { ProxyBatchRuntime } = require("../../proxy/runtime");

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

class ProxyQualityService {
  constructor({
    concurrency = process.env.SIMULATOR_PROXY_VERIFY_CONCURRENCY,
    githubProviderFactory = () => new GithubProxyRepositoryProvider(),
    maxP95Ms = process.env.SIMULATOR_PROXY_MAX_P95_MS,
    minAvailable = process.env.SIMULATOR_PROXY_MIN_AVAILABLE,
    runtimeFactory,
    timeoutMs = process.env.SIMULATOR_PROXY_VERIFY_TIMEOUT_MS,
  } = {}) {
    this.concurrency = positiveInteger(concurrency, 16);
    this.githubProviderFactory = githubProviderFactory;
    this.maxP95Ms = positiveInteger(maxP95Ms, 2000);
    this.minAvailable = positiveInteger(minAvailable, 3);
    this.timeoutMs = positiveInteger(timeoutMs, 2000);
    this.runtimeFactory = runtimeFactory ?? ((githubProvider) => new ProxyBatchRuntime({
      classifyError: classifyProxyError,
      cooldownForError: cooldownMs,
      enableGithub: true,
      githubProvider,
      stateFile: DEFAULT_STATE_FILE,
    }));
    this.job = null;
  }

  status() { return this.job ? structuredClone(this.job) : null; }

  start() {
    if (["queued", "running"].includes(this.job?.status)) {
      const error = new Error("Proxy refresh and verification is already running.");
      error.code = "proxy_quality_running";
      error.statusCode = 409;
      throw error;
    }
    const now = new Date().toISOString();
    this.job = { id: crypto.randomUUID(), status: "queued", phase: "refreshing_github", createdAt: now, startedAt: null, updatedAt: now, finishedAt: null, error: null, github: null, quality: null };
    queueMicrotask(() => this.#run(this.job));
    return this.status();
  }

  async #run(job) {
    let runtime;
    try {
      job.status = "running";
      job.startedAt = new Date().toISOString();
      job.updatedAt = job.startedAt;
      const githubProvider = this.githubProviderFactory();
      const githubCandidates = await githubProvider.listCandidates();
      job.github = { ...githubProvider.lastReport, candidateCount: githubCandidates.length };
      job.phase = "validating_eastmoney";
      job.updatedAt = new Date().toISOString();
      runtime = this.runtimeFactory(githubProvider);
      const report = await runtime.prepare({ concurrency: this.concurrency, minAvailable: 0, minSuccessRate: 0, timeoutMs: this.timeoutMs });
      job.quality = {
        ...report,
        qualified: report.available_count >= this.minAvailable && Number.isFinite(report.p95_duration_ms) && report.p95_duration_ms <= this.maxP95Ms,
        thresholds: { maxP95Ms: this.maxP95Ms, minAvailable: this.minAvailable },
      };
      job.status = "completed";
      job.phase = "completed";
    } catch (error) {
      job.status = "failed";
      job.phase = "failed";
      job.error = error.message;
    } finally {
      await runtime?.close().catch(() => {});
      job.finishedAt = new Date().toISOString();
      job.updatedAt = job.finishedAt;
    }
  }
}

module.exports = { ProxyQualityService, positiveInteger };
