"use strict";

const {
  ProbeProxyPoolUseCase,
} = require("../../../application/proxy/probe_proxy_pool");
const {
  createFilesystemProxyBenchmarkReportWriter,
} = require("../../proxy/filesystem_proxy_benchmark_reports");
const {
  createProxyPoolProbeSessionFactory,
} = require("../../proxy/proxy_pool_probe_session");
const { parseCliOptions } = require("../option_parser");

function parseDurationMs(value) {
  const match = String(value ?? "").trim().match(/^(\d+)(s|m|h)$/i);
  if (!match || Number(match[1]) < 1) {
    throw new Error(`Invalid duration: ${value}. Use values such as 30s, 30m, or 1h.`);
  }
  const multiplier = { s: 1000, m: 60_000, h: 3_600_000 }[match[2].toLowerCase()];
  return Number(match[1]) * multiplier;
}

function parsePositiveOption(value, label, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function parseProxyPoolProbeRequest(argv) {
  const options = parseCliOptions(argv);
  return {
    durationMs: parseDurationMs(options.duration ?? "10m"),
    intervalMs: parseDurationMs(options.interval ?? "30s"),
    samples: parsePositiveOption(options.samples, "--samples", 20),
    concurrency: parsePositiveOption(options.concurrency, "--concurrency", 2),
    timeoutMs: parsePositiveOption(options.hardDeadlineMs, "--hard-deadline-ms", 5000),
  };
}

function assertExecutableUseCase(value) {
  if (!value || typeof value.execute !== "function") {
    throw new TypeError("proxy pool probe useCase must expose execute().");
  }
  return value;
}

async function runProxyPoolProbeCommand({
  argv = [],
  useCase,
  getUseCase,
  stdout = process.stdout,
} = {}) {
  const request = parseProxyPoolProbeRequest(argv);
  const resolvedUseCase = assertExecutableUseCase(useCase ?? getUseCase?.());
  const report = await resolvedUseCase.execute(request);
  stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function createProxyPoolProbeCommand({
  root,
  runsDir,
  reportWriter,
  sessionFactory,
  stdout = process.stdout,
} = {}) {
  let useCase;
  return async function commandProxyPoolProbe(argv = []) {
    return runProxyPoolProbeCommand({
      argv,
      getUseCase() {
        if (!useCase) {
          useCase = new ProbeProxyPoolUseCase({
            sessionFactory: sessionFactory ?? createProxyPoolProbeSessionFactory(),
            reportWriter: reportWriter ?? createFilesystemProxyBenchmarkReportWriter({ root, runsDir }),
          });
        }
        return useCase;
      },
      stdout,
    });
  };
}

module.exports = {
  createProxyPoolProbeCommand,
  parseDurationMs,
  parseProxyPoolProbeRequest,
  runProxyPoolProbeCommand,
};
