"use strict";

const { parseCliOptions } = require("../option_parser");

function buildKlineRetryRequest(options) {
  const inputPath = options._[0];
  if (!inputPath) {
    throw new Error("kline retry requires <summary.json|failures.json>");
  }
  return { inputPath, options };
}

function requireRetryKlinesUseCase(value) {
  if (!value || typeof value.execute !== "function") {
    throw new TypeError("kline retry use case must expose execute().");
  }
  return value;
}

async function runKlineRetryCommand({
  argv = [],
  useCase,
  createUseCase,
  stdout = process.stdout,
  stderr = process.stderr,
  setExitCode = (code) => { process.exitCode = code; },
} = {}) {
  const options = parseCliOptions(argv, { engine: "aws" });
  const request = buildKlineRetryRequest(options);
  const retryKlines = requireRetryKlinesUseCase(useCase ?? createUseCase?.());
  const result = await retryKlines.execute(request);
  stdout.write(result?.result?.stdout ?? "");
  stderr.write(result?.result?.stderr ?? "");
  if ((result?.result?.exitCode ?? 0) !== 0) {
    setExitCode(result.result.exitCode);
  }
  return result;
}

function createKlineRetryCommand({
  root,
  cwd = process.cwd(),
  useCase,
  createUseCase,
  stdout = process.stdout,
  stderr = process.stderr,
  setExitCode = (code) => { process.exitCode = code; },
} = {}) {
  let defaultUseCase = null;

  function resolveUseCase() {
    if (useCase) return useCase;
    if (createUseCase) return createUseCase({ cwd, root });
    if (defaultUseCase) return defaultUseCase;

    const { RetryKlinesUseCase } = require("../../../application/kline/retry_klines");
    const { createFilesystemKlineRetryArtifacts } = require("../../kline/kline_retry_filesystem");
    const { createKlineSyncRetryRunner } = require("../../kline/kline_sync_retry_runner");
    const { createNodeScriptRunner } = require("../../system/node_script_runner");

    const artifacts = createFilesystemKlineRetryArtifacts({ cwd });
    const nodeScriptRunner = createNodeScriptRunner({ root });
    defaultUseCase = new RetryKlinesUseCase({
      createRetryCodesInput: artifacts.createRetryCodesInput,
      readRetryArtifact: artifacts.readRetryArtifact,
      runKlineSync: createKlineSyncRetryRunner({ nodeScriptRunner }),
    });
    return defaultUseCase;
  }

  return (argv = []) => runKlineRetryCommand({
    argv,
    createUseCase: resolveUseCase,
    setExitCode,
    stderr,
    stdout,
  });
}

module.exports = {
  buildKlineRetryRequest,
  createKlineRetryCommand,
  runKlineRetryCommand,
};
