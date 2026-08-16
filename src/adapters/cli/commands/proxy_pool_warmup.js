"use strict";

const {
  WarmupProxyPoolUseCase,
} = require("../../../application/proxy/warmup_proxy_pool");
const { parseCliOptions } = require("../option_parser");

function parseDurationMs(value) {
  const match = String(value ?? "").trim().match(/^(\d+)(s|m|h)$/i);
  if (!match || Number(match[1]) < 1) {
    throw new Error(`Invalid duration: ${value}. Use values such as 30s, 30m, or 1h.`);
  }
  const multiplier = { s: 1000, m: 60_000, h: 3_600_000 }[match[2].toLowerCase()];
  return Number(match[1]) * multiplier;
}

function parsePositiveOption(value, name, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return number;
}

function parseProxyPoolWarmupOptions(argv, defaults = {}) {
  return parseCliOptions(argv, defaults);
}

function requireUseCase(useCase) {
  if (!useCase || typeof useCase.execute !== "function") {
    throw new TypeError("proxy pool warmup useCase must expose execute().");
  }
  return useCase;
}

async function runProxyPoolWarmupCommand({
  argv = [],
  useCase,
  getUseCase,
  stdout = process.stdout,
  setExitCode = (code) => {
    process.exitCode = code;
  },
} = {}) {
  const options = parseProxyPoolWarmupOptions(argv);
  const request = {
    durationMs: parseDurationMs(options.duration ?? "30m"),
    samples: parsePositiveOption(options.samples, "--samples", 20),
    concurrency: parsePositiveOption(options.concurrency, "--concurrency", 4),
  };
  const resolvedUseCase = requireUseCase(useCase ?? getUseCase?.());
  const report = await resolvedUseCase.execute(request);
  stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) {
    setExitCode(2);
  }
  return report;
}

function createProxyPoolWarmupCommand({
  root,
  runsDir,
  stdout = process.stdout,
  setExitCode,
  useCase,
  benchmarkRunner,
  reportWriter,
} = {}) {
  let resolvedUseCase = useCase;

  function getUseCase() {
    if (resolvedUseCase) {
      return resolvedUseCase;
    }

    let resolvedBenchmarkRunner = benchmarkRunner;
    if (!resolvedBenchmarkRunner) {
      const {
        createProxyPoolBenchmarkRunner,
      } = require("../../proxy/proxy_pool_benchmark_runner");
      resolvedBenchmarkRunner = createProxyPoolBenchmarkRunner();
    }

    let resolvedReportWriter = reportWriter;
    if (!resolvedReportWriter) {
      const {
        createFilesystemProxyBenchmarkReportWriter,
      } = require("../../proxy/filesystem_proxy_benchmark_reports");
      resolvedReportWriter = createFilesystemProxyBenchmarkReportWriter({ root, runsDir });
    }

    resolvedUseCase = new WarmupProxyPoolUseCase({
      benchmarkRunner: resolvedBenchmarkRunner,
      reportWriter: resolvedReportWriter,
    });
    return resolvedUseCase;
  }

  return (argv = []) => runProxyPoolWarmupCommand({
    argv,
    getUseCase,
    setExitCode,
    stdout,
  });
}

module.exports = {
  createProxyPoolWarmupCommand,
  parseDurationMs,
  parsePositiveOption,
  parseProxyPoolWarmupOptions,
  runProxyPoolWarmupCommand,
};
