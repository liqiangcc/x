"use strict";

const {
  assertProxyBenchmarkReportWriter,
} = require("../../ports/proxy/proxy_diagnostics");
const {
  assertProxyPoolProbeSession,
  assertProxyPoolProbeSessionFactory,
} = require("../../ports/proxy/proxy_probe");

function buildProxyProbeRound(rawReport, startedAt) {
  return {
    ...rawReport,
    passed: Number(rawReport?.available_count ?? 0) > 0,
    started_at: startedAt,
  };
}

function buildProxyProbeReport({ durationMs, intervalMs, rounds }) {
  return {
    duration_ms: durationMs,
    interval_ms: intervalMs,
    rounds,
    target: "eastmoney-kline",
  };
}

class ProbeProxyPoolUseCase {
  constructor({
    sessionFactory,
    reportWriter,
    now = () => Date.now(),
    timestamp = () => new Date().toISOString(),
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  } = {}) {
    this.sessionFactory = assertProxyPoolProbeSessionFactory(sessionFactory);
    this.reportWriter = assertProxyBenchmarkReportWriter(reportWriter);
    this.now = now;
    this.timestamp = timestamp;
    this.sleep = sleep;
  }

  async execute({
    durationMs = 10 * 60_000,
    intervalMs = 30_000,
    samples = 20,
    concurrency = 2,
    timeoutMs = 5000,
  } = {}) {
    const deadline = this.now() + durationMs;
    const rounds = [];
    const session = assertProxyPoolProbeSession(await this.sessionFactory.open());

    try {
      let startIndex = 0;
      do {
        const rawReport = await session.sample({
          concurrency,
          samples,
          startIndex,
          timeoutMs,
        });
        rounds.push(buildProxyProbeRound(rawReport, this.timestamp()));
        startIndex += samples;

        const remainingMs = deadline - this.now();
        if (remainingMs > 0) {
          await this.sleep(Math.min(intervalMs, remainingMs));
        }
      } while (this.now() < deadline);
    } finally {
      await session.close();
    }

    const report = buildProxyProbeReport({ durationMs, intervalMs, rounds });
    const reportPath = await this.reportWriter.write(report, "probe");
    return {
      ...report,
      report: reportPath,
    };
  }
}

module.exports = {
  ProbeProxyPoolUseCase,
  buildProxyProbeReport,
  buildProxyProbeRound,
};
