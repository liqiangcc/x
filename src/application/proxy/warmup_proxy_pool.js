"use strict";

const {
  assertProxyBenchmarkReportWriter,
} = require("../../ports/proxy/proxy_diagnostics");
const {
  assertProxyPoolBenchmarkRunner,
} = require("../../ports/proxy/proxy_benchmark");

const WARMUP_INTERVAL_MS = 60_000;

function buildProxyWarmupRound(round = {}) {
  return {
    samples: round.samples,
    success: round.success,
    failed: round.failed,
    success_rate: round.success_rate,
    eligible_proxy_count: round.eligible_proxy_count,
    stable_proxy_count: round.stable_proxy_count,
    p95_duration_ms: round.p95_duration_ms,
    passed: round.passed,
    selector: round.selector,
    target: round.target,
  };
}

function buildProxyWarmupReport({ durationMs, rounds, startedAt, finishedAt }) {
  return {
    started_at: startedAt,
    finished_at: finishedAt,
    duration_ms: durationMs,
    rounds: rounds.map(buildProxyWarmupRound),
    passed: rounds.some((round) => round.passed),
  };
}

class WarmupProxyPoolUseCase {
  constructor({
    benchmarkRunner,
    reportWriter,
    now = () => Date.now(),
    timestamp = () => new Date().toISOString(),
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  } = {}) {
    this.benchmarkRunner = assertProxyPoolBenchmarkRunner(benchmarkRunner);
    this.reportWriter = assertProxyBenchmarkReportWriter(reportWriter);
    this.now = now;
    this.timestamp = timestamp;
    this.sleep = sleep;
  }

  async execute({
    durationMs = 30 * 60_000,
    samples = 20,
    concurrency = 4,
  } = {}) {
    const deadline = this.now() + durationMs;
    const rounds = [];

    do {
      rounds.push(await this.benchmarkRunner.run({ samples, concurrency }));
      const remainingMs = deadline - this.now();
      if (remainingMs > 0) {
        await this.sleep(Math.min(WARMUP_INTERVAL_MS, remainingMs));
      }
    } while (this.now() < deadline);

    const report = buildProxyWarmupReport({
      durationMs,
      rounds,
      startedAt: rounds[0]?.started_at ?? this.timestamp(),
      finishedAt: this.timestamp(),
    });
    const reportPath = await this.reportWriter.write(report, "warmup");
    return {
      ...report,
      report: reportPath,
    };
  }
}

module.exports = {
  WARMUP_INTERVAL_MS,
  WarmupProxyPoolUseCase,
  buildProxyWarmupReport,
  buildProxyWarmupRound,
};
