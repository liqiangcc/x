"use strict";

const {
  RunAwsLatencyBenchmarkUseCase,
} = require("../../../application/aws/run_latency_benchmark");
const {
  createAwsLatencyBenchmarkRunner,
} = require("../../aws/aws_latency_benchmark_runner");
const {
  createFilesystemLatencyArtifacts,
} = require("../../aws/filesystem_latency_artifacts");
const { formatLatencyReport } = require("../../../aws/latency");
const { parseCliOptions } = require("../option_parser");

function parseAwsLatencyOptions(argv, defaults = {}) {
  return parseCliOptions(argv, defaults);
}

function requireUseCase(useCase) {
  if (!useCase || typeof useCase.execute !== "function") {
    throw new TypeError("aws latency useCase must expose execute().");
  }
  return useCase;
}

async function runAwsLatencyCommand({
  argv = [],
  useCase,
  stdout = process.stdout,
} = {}) {
  const options = parseAwsLatencyOptions(argv);
  const {
    _: _positionals,
    config = null,
    json = false,
    output = null,
    ...benchmarkOptions
  } = options;

  const report = await requireUseCase(useCase).execute({
    config,
    output,
    options: benchmarkOptions,
  });

  if (json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    stdout.write(formatLatencyReport(report));
  }
  return report;
}

function createAwsLatencyCommand({
  root,
  stdout = process.stdout,
  useCase,
  configReader,
  benchmarkRunner,
  reportWriter,
} = {}) {
  let resolvedUseCase = useCase;

  const getUseCase = () => {
    if (resolvedUseCase) {
      return resolvedUseCase;
    }

    const artifacts = (!configReader || !reportWriter)
      ? createFilesystemLatencyArtifacts({ root })
      : null;
    resolvedUseCase = new RunAwsLatencyBenchmarkUseCase({
      configReader: configReader ?? artifacts,
      benchmarkRunner: benchmarkRunner ?? createAwsLatencyBenchmarkRunner(),
      reportWriter: reportWriter ?? artifacts,
    });
    return resolvedUseCase;
  };

  return (argv = []) => runAwsLatencyCommand({
    argv,
    useCase: getUseCase(),
    stdout,
  });
}

module.exports = {
  createAwsLatencyCommand,
  parseAwsLatencyOptions,
  runAwsLatencyCommand,
};
