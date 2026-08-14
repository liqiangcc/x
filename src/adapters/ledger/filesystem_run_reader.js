"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const ARTIFACT_FILES = Object.freeze({
  failures: "failures.json",
  run: "run.json",
});

function assertRunsDir(runsDir) {
  const resolved = path.resolve(String(runsDir ?? "").trim());
  if (!String(runsDir ?? "").trim()) {
    throw new TypeError("runsDir is required.");
  }
  return resolved;
}

function artifactPath(runsDir, runId, artifact) {
  const fileName = ARTIFACT_FILES[artifact];
  if (!fileName) {
    throw new TypeError(`Unsupported run artifact: ${artifact}`);
  }
  const runDir = path.resolve(runsDir, runId);
  const runsPrefix = `${runsDir}${path.sep}`;
  if (!runDir.startsWith(runsPrefix)) {
    throw new TypeError("runId resolves outside runsDir.");
  }
  return path.join(runDir, fileName);
}

function createFilesystemRunReader({ runsDir } = {}) {
  const resolvedRunsDir = assertRunsDir(runsDir);

  return {
    async listRunIds() {
      const entries = await fs
        .readdir(resolvedRunsDir, { withFileTypes: true })
        .catch(() => []);
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    },

    async readArtifact({ runId, artifact } = {}) {
      return fs.readFile(
        artifactPath(resolvedRunsDir, runId, artifact),
        "utf8"
      );
    },
  };
}

module.exports = {
  ARTIFACT_FILES,
  artifactPath,
  createFilesystemRunReader,
};
