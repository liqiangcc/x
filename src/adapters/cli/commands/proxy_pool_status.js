"use strict";

const {
  CheckProxyPoolStatusUseCase,
} = require("../../../application/proxy/check_proxy_pool_status");
const { parseCliOptions } = require("../option_parser");

function parseProxyPoolStatusOptions(argv, defaults = {}) {
  return parseCliOptions(argv, defaults);
}

function requireUseCase(useCase) {
  if (!useCase || typeof useCase.execute !== "function") {
    throw new TypeError("proxy pool status useCase must expose execute().");
  }
  return useCase;
}

async function runProxyPoolStatusCommand({
  argv = [],
  useCase,
  getUseCase,
  stdout = process.stdout,
  stderr = process.stderr,
  setExitCode = (code) => {
    process.exitCode = code;
  },
} = {}) {
  parseProxyPoolStatusOptions(argv);
  const resolvedUseCase = requireUseCase(useCase ?? getUseCase?.());
  const result = await resolvedUseCase.execute();

  stdout.write(result.runtime?.stdout ?? "");
  stderr.write(result.runtime?.stderr ?? "");
  stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
  if (result.exitCode !== 0) {
    setExitCode(result.exitCode);
  }
  return result.report;
}

function createProxyPoolStatusCommand({
  root,
  stdout = process.stdout,
  stderr = process.stderr,
  setExitCode,
  useCase,
  runtimeInspector,
  candidateCounter,
} = {}) {
  let resolvedUseCase = useCase;

  function getUseCase() {
    if (resolvedUseCase) {
      return resolvedUseCase;
    }

    let resolvedRuntimeInspector = runtimeInspector;
    if (!resolvedRuntimeInspector) {
      const {
        createDockerComposeProxyPoolRuntimeInspector,
      } = require("../../proxy/docker_compose_proxy_pool_runtime_inspector");
      resolvedRuntimeInspector = createDockerComposeProxyPoolRuntimeInspector({ root });
    }

    let resolvedCandidateCounter = candidateCounter;
    if (!resolvedCandidateCounter) {
      const {
        createProxyPoolCandidateCounter,
      } = require("../../proxy/proxy_pool_candidate_counter");
      resolvedCandidateCounter = createProxyPoolCandidateCounter();
    }

    resolvedUseCase = new CheckProxyPoolStatusUseCase({
      runtimeInspector: resolvedRuntimeInspector,
      candidateCounter: resolvedCandidateCounter,
    });
    return resolvedUseCase;
  }

  return (argv = []) =>
    runProxyPoolStatusCommand({
      argv,
      getUseCase,
      setExitCode,
      stderr,
      stdout,
    });
}

module.exports = {
  createProxyPoolStatusCommand,
  parseProxyPoolStatusOptions,
  runProxyPoolStatusCommand,
};
