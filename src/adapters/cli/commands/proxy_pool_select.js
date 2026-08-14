"use strict";

const {
  SelectProxyPoolUseCase,
} = require("../../../application/proxy/select_proxy_pool");
const { parseCliOptions } = require("../option_parser");

function parseProxyPoolSelectOptions(argv, defaults = {}) {
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

function parseSuccessRate(value) {
  const number = Number(value ?? 0.8);
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    throw new Error("--min-success-rate must be between 0 and 1.");
  }
  return number;
}

function requireUseCase(useCase) {
  if (!useCase || typeof useCase.execute !== "function") {
    throw new TypeError("proxy pool select useCase must expose execute().");
  }
  return useCase;
}

async function runProxyPoolSelectCommand({
  argv = [],
  useCase,
  getUseCase,
  stdout = process.stdout,
} = {}) {
  const options = parseProxyPoolSelectOptions(argv);
  const request = {
    limit: parsePositiveOption(options.limit, "--limit", 5),
    maxP95Ms: parsePositiveOption(options.maxP95Ms, "--max-p95-ms", 3000),
    minSamples: parsePositiveOption(options.minSamples, "--min-samples", 5),
    minSuccessRate: parseSuccessRate(options.minSuccessRate),
    output: options.output ?? null,
  };

  const resolvedUseCase = requireUseCase(useCase ?? getUseCase?.());
  const report = await resolvedUseCase.execute(request);
  stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function createProxyPoolSelectCommand({
  root,
  stdout = process.stdout,
  useCase,
  healthStateReader,
  reportStore,
  now,
} = {}) {
  let resolvedUseCase = useCase;

  function getUseCase() {
    if (resolvedUseCase) return resolvedUseCase;

    let resolvedHealthStateReader = healthStateReader;
    if (!resolvedHealthStateReader) {
      const {
        createFilesystemProxyHealthStateReader,
      } = require("../../proxy/filesystem_proxy_health_state_reader");
      resolvedHealthStateReader = createFilesystemProxyHealthStateReader({ root });
    }

    let resolvedReportStore = reportStore;
    if (!resolvedReportStore) {
      const {
        createFilesystemProxySelectionReportStore,
      } = require("../../proxy/filesystem_proxy_selection_report_store");
      resolvedReportStore = createFilesystemProxySelectionReportStore({ root });
    }

    resolvedUseCase = new SelectProxyPoolUseCase({
      healthStateReader: resolvedHealthStateReader,
      reportStore: resolvedReportStore,
      now,
    });
    return resolvedUseCase;
  }

  return (argv = []) => runProxyPoolSelectCommand({
    argv,
    getUseCase,
    stdout,
  });
}

module.exports = {
  createProxyPoolSelectCommand,
  parsePositiveOption,
  parseProxyPoolSelectOptions,
  parseSuccessRate,
  runProxyPoolSelectCommand,
};
