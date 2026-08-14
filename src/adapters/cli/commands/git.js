"use strict";

const {
  CommitRunDataUseCase,
  GetDataStatusUseCase,
} = require("../../../application/git/data_commands");
const {
  createExecGitDataWorkspace,
} = require("../../git/exec_git_workspace");
const {
  createFilesystemRunCommitContextReader,
} = require("../../ledger/filesystem_run_commit_context_reader");
const { parseCliOptions } = require("../option_parser");

function parseGitOptions(argv, defaults = {}) {
  return parseCliOptions(argv, defaults);
}

function requireUseCase(useCase, label) {
  if (!useCase || typeof useCase.execute !== "function") {
    throw new TypeError(`${label} must expose execute().`);
  }
  return useCase;
}

async function runCommitData({
  runId,
  commitDataUseCase,
  stdout = process.stdout,
} = {}) {
  const useCase = requireUseCase(commitDataUseCase, "commitDataUseCase");
  const result = await useCase.execute({ runId });

  if (result?.status === "no-data-paths") {
    stdout.write("No data paths to commit.\n");
  } else if (result?.status === "no-data-changes") {
    stdout.write("No data changes to commit.\n");
  } else if (result?.status !== "committed") {
    throw new TypeError("commitDataUseCase returned an unsupported status.");
  }
  return result;
}

async function runGitCommand({
  argv = [],
  commitDataUseCase,
  getCommitDataUseCase,
  getStatusDataUseCase,
  statusDataUseCase,
  stdout = process.stdout,
} = {}) {
  const subcommand = argv[0];

  if (subcommand === "status-data") {
    const useCase = requireUseCase(
      statusDataUseCase ?? getStatusDataUseCase?.(),
      "statusDataUseCase"
    );
    const status = await useCase.execute();
    stdout.write(status);
    return status;
  }

  if (subcommand === "commit-data") {
    const options = parseGitOptions(argv.slice(1));
    if (!options.runId) {
      throw new Error("git commit-data requires --run-id <run_id>");
    }
    return runCommitData({
      commitDataUseCase: commitDataUseCase ?? getCommitDataUseCase?.(),
      runId: options.runId,
      stdout,
    });
  }

  throw new Error(`Unknown git command: ${subcommand ?? ""}`);
}

function createGitDataCli({
  root,
  runsDir,
  stdout = process.stdout,
  workspace,
  runCommitContextReader,
  commitDataUseCase,
  statusDataUseCase,
} = {}) {
  let sharedWorkspace = workspace;
  let resolvedCommitDataUseCase = commitDataUseCase;
  let resolvedStatusDataUseCase = statusDataUseCase;

  const getWorkspace = () => {
    sharedWorkspace ??= createExecGitDataWorkspace({ root });
    return sharedWorkspace;
  };

  const getCommitDataUseCase = () => {
    resolvedCommitDataUseCase ??= new CommitRunDataUseCase({
      runCommitContextReader: runCommitContextReader
        ?? createFilesystemRunCommitContextReader({ runsDir }),
      workspace: getWorkspace(),
    });
    return resolvedCommitDataUseCase;
  };

  const getStatusDataUseCase = () => {
    resolvedStatusDataUseCase ??= new GetDataStatusUseCase({
      workspace: getWorkspace(),
    });
    return resolvedStatusDataUseCase;
  };

  return {
    command(argv) {
      return runGitCommand({
        argv,
        commitDataUseCase,
        getCommitDataUseCase,
        getStatusDataUseCase,
        statusDataUseCase,
        stdout,
      });
    },
    commitData(runId) {
      return runCommitData({
        commitDataUseCase: getCommitDataUseCase(),
        runId,
        stdout,
      });
    },
  };
}

function createGitCommand(options = {}) {
  return createGitDataCli(options).command;
}

module.exports = {
  createGitCommand,
  createGitDataCli,
  parseGitOptions,
  runCommitData,
  runGitCommand,
};
