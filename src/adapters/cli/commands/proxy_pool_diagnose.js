"use strict";

const {
  DiagnoseProxyPoolUseCase,
} = require("../../../application/proxy/diagnose_proxy_pool");
const { parseCliOptions } = require("../option_parser");

function parseProxyPoolDiagnoseOptions(argv, defaults = {}) {
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
    throw new TypeError("proxy pool diagnose useCase must expose execute().");
  }
  return useCase;
}

async function runProxyPoolDiagnoseCommand({
  argv = [],
  useCase,
  getUseCase,
  stdout = process.stdout,
} = {}) {
  const options = parseProxyPoolDiagnoseOptions(argv);
  const request = {
    concurrency: parsePositiveOption(options.concurrency, "--concurrency", 16),
    samples: parsePositiveOption(options.samples, "--samples", 100),
    timeoutMs: parsePositiveOption(options.timeoutMs, "--timeout-ms", 3000),
  };
  const resolvedUseCase = requireUseCase(useCase ?? getUseCase?.());
  const report = await resolvedUseCase.execute(request);
  stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function createProxyPoolDiagnoseCommand({
  root,
  runsDir,
  stdout = process.stdout,
  useCase,
  diagnosticRunner,
  reportWriter,
} = {}) {
  let resolvedUseCase = useCase;

  function getUseCase() {
    if (resolvedUseCase) {
      return resolvedUseCase;
    }

    let resolvedDiagnosticRunner = diagnosticRunner;
    if (!resolvedDiagnosticRunner) {
      const {
        createProxyPoolDiagnosticRunner,
      } = require("../../proxy/proxy_pool_diagnostic_runner");
      resolvedDiagnosticRunner = createProxyPoolDiagnosticRunner();
    }

    let resolvedReportWriter = reportWriter;
    if (!resolvedReportWriter) {
      const {
        createFilesystemProxyBenchmarkReportWriter,
      } = require("../../proxy/filesystem_proxy_benchmark_reports");
      resolvedReportWriter = createFilesystemProxyBenchmarkReportWriter({ root, runsDir });
    }

    resolvedUseCase = new DiagnoseProxyPoolUseCase({
      diagnosticRunner: resolvedDiagnosticRunner,
      reportWriter: resolvedReportWriter,
    });
    return resolvedUseCase;
  }

  return (argv = []) => runProxyPoolDiagnoseCommand({
    argv,
    getUseCase,
    stdout,
  });
}

module.exports = {
  createProxyPoolDiagnoseCommand,
  parsePositiveOption,
  parseProxyPoolDiagnoseOptions,
  runProxyPoolDiagnoseCommand,
};
