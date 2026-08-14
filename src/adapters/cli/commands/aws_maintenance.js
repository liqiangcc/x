"use strict";

const {
  CheckAwsMaintenanceStatusUseCase,
  SyncAwsGitHubSettingsUseCase,
} = require("../../../application/aws/maintenance_commands");
const { parseCliOptions } = require("../option_parser");

function parseAwsMaintenanceOptions(argv, defaults = {}) {
  return parseCliOptions(argv, defaults);
}

function requireUseCase(useCase, label) {
  if (!useCase || typeof useCase.execute !== "function") {
    throw new TypeError(`${label} must expose execute().`);
  }
  return useCase;
}

async function runAwsMaintenanceCommand({
  argv = [],
  getStatusUseCase,
  getSyncUseCase,
  setExitCode = (code) => { process.exitCode = code; },
  statusUseCase,
  syncUseCase,
  stdout = process.stdout,
} = {}) {
  const subcommand = argv[0];

  if (subcommand === "status") {
    const options = parseAwsMaintenanceOptions(argv.slice(1));
    const useCase = requireUseCase(
      statusUseCase ?? getStatusUseCase?.(),
      "statusUseCase"
    );
    const result = await useCase.execute(options);
    stdout.write(`${JSON.stringify(result.summary, null, 2)}\n`);
    if (result.exitCode !== 0) setExitCode(result.exitCode);
    return result;
  }

  if (subcommand === "sync-github-secrets") {
    const options = parseAwsMaintenanceOptions(argv.slice(1));
    const useCase = requireUseCase(
      syncUseCase ?? getSyncUseCase?.(),
      "syncUseCase"
    );
    const result = await useCase.execute(options);
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  }

  throw new Error(`Unknown aws command: ${subcommand ?? ""}`);
}

function createAwsMaintenanceCommand({
  root,
  stdout = process.stdout,
  setExitCode = (code) => { process.exitCode = code; },
  maintenanceReader,
  githubSettingsWriter,
  statusUseCase,
  syncUseCase,
} = {}) {
  let sharedRuntime = null;
  let resolvedStatusUseCase = statusUseCase;
  let resolvedSyncUseCase = syncUseCase;

  function getRuntime() {
    if (!sharedRuntime) {
      const {
        createExecAwsMaintenanceRuntime,
      } = require("../../aws/exec_maintenance_runtime");
      sharedRuntime = createExecAwsMaintenanceRuntime({ root });
    }
    return sharedRuntime;
  }

  function getMaintenanceReader() {
    return maintenanceReader ?? getRuntime();
  }

  function getGitHubSettingsWriter() {
    return githubSettingsWriter ?? getRuntime();
  }

  function getStatusUseCase() {
    resolvedStatusUseCase ??= new CheckAwsMaintenanceStatusUseCase({
      maintenanceReader: getMaintenanceReader(),
    });
    return resolvedStatusUseCase;
  }

  function getSyncUseCase() {
    resolvedSyncUseCase ??= new SyncAwsGitHubSettingsUseCase({
      maintenanceReader: getMaintenanceReader(),
      githubSettingsWriter: getGitHubSettingsWriter(),
    });
    return resolvedSyncUseCase;
  }

  return (argv) => runAwsMaintenanceCommand({
    argv,
    getStatusUseCase,
    getSyncUseCase,
    setExitCode,
    statusUseCase,
    syncUseCase,
    stdout,
  });
}

module.exports = {
  createAwsMaintenanceCommand,
  parseAwsMaintenanceOptions,
  runAwsMaintenanceCommand,
};
