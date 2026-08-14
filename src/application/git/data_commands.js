"use strict";

const { dataCommitMessage } = require("../../core/data_commit");
const { dataCommitPathspecs } = require("../../core/data_paths");
const {
  assertDataCommitWorkspace,
  assertDataStatusWorkspace,
} = require("../../ports/git/data_workspace");
const {
  assertRunCommitContextReader,
} = require("../../ports/runs/run_commit_context_reader");

const DEFAULT_DATA_STATUS_CANDIDATES = Object.freeze([
  "data",
  "runs",
  "reports",
]);

function normalizeRunId(value) {
  const runId = String(value ?? "").trim();
  if (!runId) throw new TypeError("runId is required.");
  return runId;
}

function requireStringArray(value, label) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must return an array.`);
  }
  return value.map(String);
}

class GetDataStatusUseCase {
  constructor({ workspace } = {}) {
    this.workspace = assertDataStatusWorkspace(workspace);
  }

  async execute() {
    const pathspec = requireStringArray(
      await this.workspace.existingPathspecs(DEFAULT_DATA_STATUS_CANDIDATES),
      "workspace.existingPathspecs()"
    );
    const status = await this.workspace.status({ pathspec });
    if (typeof status !== "string") {
      throw new TypeError("workspace.status() must return a string.");
    }
    return status;
  }
}

class CommitRunDataUseCase {
  constructor({ runCommitContextReader, workspace } = {}) {
    this.runCommitContextReader = assertRunCommitContextReader(
      runCommitContextReader
    );
    this.workspace = assertDataCommitWorkspace(workspace);
  }

  async execute({ runId } = {}) {
    const normalizedRunId = normalizeRunId(runId);
    const context = await this.runCommitContextReader.readCommitContext({
      runId: normalizedRunId,
    });
    if (!context || typeof context !== "object") {
      throw new TypeError("runCommitContextReader.readCommitContext() must return an object.");
    }

    const run = context.run;
    const quality = context.quality ?? { status: "recorded" };
    const pathspec = requireStringArray(
      await this.workspace.existingPathspecs(dataCommitPathspecs(run)),
      "workspace.existingPathspecs()"
    );

    if (pathspec.length === 0) {
      return { status: "no-data-paths" };
    }

    await this.workspace.stage({ pathspec });
    const files = requireStringArray(
      await this.workspace.stagedFiles({ pathspec }),
      "workspace.stagedFiles()"
    );
    if (files.length === 0) {
      return { status: "no-data-changes" };
    }

    const message = dataCommitMessage(run, quality);
    await this.workspace.commit({
      body: message.body,
      files,
      title: message.title,
    });
    return {
      files,
      message,
      status: "committed",
    };
  }
}

module.exports = {
  DEFAULT_DATA_STATUS_CANDIDATES,
  CommitRunDataUseCase,
  GetDataStatusUseCase,
  normalizeRunId,
  requireStringArray,
};
