"use strict";

const {
  VerifyProxyPoolUseCase,
} = require("../../../application/proxy/verify_proxy_pool");
const { parseCliOptions } = require("../option_parser");

function parseProxyPoolVerifyOptions(argv, defaults = {}) {
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
    throw new TypeError("proxy pool verify useCase must expose execute().");
  }
  return useCase;
}

async function runProxyPoolVerifyCommand({
  argv = [],
  useCase,
  getUseCase,
  stdout = process.stdout,
  setExitCode = (code) => {
    process.exitCode = code;
  },
} = {}) {
  const options = parseProxyPoolVerifyOptions(argv);
  const request = {
    concurrency: parsePositiveOption(options.concurrency, "--concurrency", 8),
    timeoutMs: parsePositiveOption(options.timeoutMs, "--timeout-ms", 6000),
    output: options.output ?? null,
  };
  if (options.limit !== undefined) {
    request.limit = parsePositiveOption(options.limit, "--limit");
  }

  const resolvedUseCase = requireUseCase(useCase ?? getUseCase?.());
  const report = await resolvedUseCase.execute(request);
  stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.available_count === 0) {
    setExitCode(2);
  }
  return report;
}

function createProxyPoolVerifyCommand({
  root,
  runsDir,
  stdout = process.stdout,
  setExitCode,
  useCase,
  verifier,
  reportWriter,
} = {}) {
  let resolvedUseCase = useCase;

  function getUseCase() {
    if (resolvedUseCase) {
      return resolvedUseCase;
    }

    let resolvedVerifier = verifier;
    if (!resolvedVerifier) {
      const {
        createProxyPoolVerifier,
      } = require("../../proxy/proxy_pool_verifier");
      resolvedVerifier = createProxyPoolVerifier();
    }

    let resolvedReportWriter = reportWriter;
    if (!resolvedReportWriter) {
      const {
        createFilesystemProxyVerificationReportWriter,
      } = require("../../proxy/filesystem_proxy_verification_report_writer");
      resolvedReportWriter = createFilesystemProxyVerificationReportWriter({ root, runsDir });
    }

    resolvedUseCase = new VerifyProxyPoolUseCase({
      verifier: resolvedVerifier,
      reportWriter: resolvedReportWriter,
    });
    return resolvedUseCase;
  }

  return (argv = []) => runProxyPoolVerifyCommand({
    argv,
    getUseCase,
    setExitCode,
    stdout,
  });
}

module.exports = {
  createProxyPoolVerifyCommand,
  parsePositiveOption,
  parseProxyPoolVerifyOptions,
  runProxyPoolVerifyCommand,
};
