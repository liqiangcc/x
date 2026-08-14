"use strict";

const {
  ListRunsUseCase,
  ReadRunArtifactUseCase,
} = require("../../../application/runs/query_runs");
const { createFilesystemRunReader } = require("../../ledger/filesystem_run_reader");

async function runRunCommand({
  argv = [],
  listRunsUseCase,
  readRunArtifactUseCase,
  stdout = process.stdout,
} = {}) {
  if (!listRunsUseCase || typeof listRunsUseCase.execute !== "function") {
    throw new TypeError("listRunsUseCase must expose execute().");
  }
  if (!readRunArtifactUseCase || typeof readRunArtifactUseCase.execute !== "function") {
    throw new TypeError("readRunArtifactUseCase must expose execute().");
  }

  const subcommand = argv[0];
  if (subcommand === "list") {
    const runIds = await listRunsUseCase.execute();
    for (const runId of runIds) {
      stdout.write(`${runId}\n`);
    }
    return { runIds, subcommand };
  }

  const runId = argv[1];
  if (!runId) {
    throw new Error(`run ${subcommand ?? ""} requires <run_id>`);
  }

  const artifact = subcommand === "failures" ? "failures" : "run";
  const content = await readRunArtifactUseCase.execute({ artifact, runId });
  stdout.write(content);
  return { artifact, runId, subcommand };
}

function createRunCommand({
  runsDir,
  runListReader,
  runArtifactReader,
  stdout = process.stdout,
  listRunsUseCase,
  readRunArtifactUseCase,
} = {}) {
  let filesystemRunReader = null;
  const getFilesystemRunReader = () => {
    filesystemRunReader ??= createFilesystemRunReader({ runsDir });
    return filesystemRunReader;
  };

  const resolvedListRunsUseCase = listRunsUseCase ?? new ListRunsUseCase({
    runReader: runListReader ?? getFilesystemRunReader(),
  });
  const resolvedReadRunArtifactUseCase = readRunArtifactUseCase ?? new ReadRunArtifactUseCase({
    runReader: runArtifactReader ?? getFilesystemRunReader(),
  });

  return (argv) => runRunCommand({
    argv,
    listRunsUseCase: resolvedListRunsUseCase,
    readRunArtifactUseCase: resolvedReadRunArtifactUseCase,
    stdout,
  });
}

module.exports = {
  createRunCommand,
  runRunCommand,
};
