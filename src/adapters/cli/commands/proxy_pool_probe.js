"use strict";

const {
  ProbeProxyPoolUseCase,
} = require("../../../application/proxy/probe_proxy_pool");
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
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
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

function requireUseCase(useCase) {
  if (!useCase || typeof useCase.execute !== "function") {
    throw new TypeError("proxy pool probe useCase must expose execute().");
  }
  return useCase;
}

async function runProxyPoolProbeCommand({
  argv = [],
  useCase,
  getUseCase,
  stdout = process.stdout,
} = {}) {
  const request = parseProxyPoolProbeRequest(argv);
  const resolvedUseCase = requireUseCase(useCase ?? getUseCase?.());
  const report = await resolvedUseCase.execute(request);
  stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function createProxyPoolProbeCommand({
  root,
  runsDir,
  stdout = process.stdout,
  useCase,
  sessionFactory,
  reportWriter,
} = {}) {
  let resolvedUseCase = useCase;

  function getUseCase() {
    if (resolvedUseCase) {
      return resolvedUseCase;
    }

    let resolvedSessionFactory = sessionFactory;
    if (!resolvedSessionFactory) {
      const {
        createProxyPoolProbeSessionFactory,
      } = require("../../proxy/proxy_pool_probe_session");
      resolvedSessionFactory = createProxyPoolProbeSessionFactory();
    }

    let resolvedReportWriter = reportWriter;
    if (!resolvedReportWriter) {
      const {
        createFilesystemProxyBenchmarkReportWriter,
      } = require("../../proxy/filesystem_proxy_benchmark_reports");
      resolvedReportWriter = createFilesystemProxyBenchmarkReportWriter({ root, runsDir });
    }

    resolvedUseCase = new ProbeProxyPoolUseCase({
      sessionFactory: resolvedSessionFactory,
      reportWriter: resolvedReportWriter,
    });
    return resolvedUseCase;
  }

  return (argv = []) => runProxyPoolProbeCommand({
    argv,
    getUseCase,
    stdout,
  });
}

module.exports = {
  createProxyPoolProbeCommand,
  parseDurationMs,
  parsePositiveOption,
  parseProxyPoolProbeRequest,
  runProxyPoolProbeCommand,
};
