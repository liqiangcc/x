"use strict";

const {
  RunProxyPoolBenchmarkUseCase,
} = require("../../../application/proxy/run_proxy_pool_benchmark");
const { parseCliOptions } = require("../option_parser");

function parseProxyPoolBenchmarkOptions(argv, defaults = {}) {
  return parseCliOptions(argv, defaults);
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

function requireUseCase(useCase) {
  if (!useCase || typeof useCase.execute !== "function") {
    throw new TypeError("proxy pool benchmark useCase must expose execute().");
  }
  return useCase;
}

async function runProxyPoolBenchmarkCommand({
  argv = [],
  useCase,
  getUseCase,
  stdout = process.stdout,
  setExitCode = (code) => {
    process.exitCode = code;
  },
} = {}) {
  const options = parseProxyPoolBenchmarkOptions(argv);
  const request = {
    samples: parsePositiveOption(options.samples, "--samples", 100),
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

function createProxyPoolBenchmarkCommand({
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

    resolvedUseCase = new RunProxyPoolBenchmarkUseCase({
      benchmarkRunner: resolvedBenchmarkRunner,
      reportWriter: resolvedReportWriter,
    });
    return resolvedUseCase;
  }

  return (argv = []) => runProxyPoolBenchmarkCommand({
    argv,
    getUseCase,
    setExitCode,
    stdout,
  });
}

module.exports = {
  createProxyPoolBenchmarkCommand,
  parsePositiveOption,
  parseProxyPoolBenchmarkOptions,
  runProxyPoolBenchmarkCommand,
};
