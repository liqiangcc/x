"use strict";

const {
  assertRunArtifactReader,
  assertRunListReader,
} = require("../../ports/runs/run_reader");

const RUN_ARTIFACTS = Object.freeze(["run", "failures"]);

function normalizeRunId(value) {
  const runId = String(value ?? "").trim();
  if (!runId) {
    throw new TypeError("runId is required.");
  }
  if (runId === "." || runId === ".." || runId.includes("/") || runId.includes("\\")) {
    throw new TypeError("runId contains unsupported path characters.");
  }
  return runId;
}

function normalizeRunArtifact(value) {
  const artifact = String(value ?? "").trim();
  if (!RUN_ARTIFACTS.includes(artifact)) {
    throw new TypeError(`artifact must be one of: ${RUN_ARTIFACTS.join(", ")}.`);
  }
  return artifact;
}

class ListRunsUseCase {
  constructor({ runReader } = {}) {
    this.runReader = assertRunListReader(runReader);
  }

  async execute() {
    const runIds = await this.runReader.listRunIds();
    if (!Array.isArray(runIds)) {
      throw new TypeError("runReader.listRunIds() must return an array.");
    }
    return [...new Set(runIds.map((value) => String(value).trim()).filter(Boolean))].sort();
  }
}

class ReadRunArtifactUseCase {
  constructor({ runReader } = {}) {
    this.runReader = assertRunArtifactReader(runReader);
  }

  async execute({ runId, artifact } = {}) {
    const normalizedRunId = normalizeRunId(runId);
    const normalizedArtifact = normalizeRunArtifact(artifact);
    const content = await this.runReader.readArtifact({
      artifact: normalizedArtifact,
      runId: normalizedRunId,
    });
    if (typeof content !== "string") {
      throw new TypeError("runReader.readArtifact() must return a string.");
    }
    return content;
  }
}

module.exports = {
  RUN_ARTIFACTS,
  ListRunsUseCase,
  ReadRunArtifactUseCase,
  normalizeRunArtifact,
  normalizeRunId,
};
