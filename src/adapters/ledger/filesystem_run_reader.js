"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const ARTIFACT_FILES = Object.freeze({
  failures: "failures.json",
  run: "run.json",
});

function assertRunsDir(runsDir) {
  const text = String(runsDir ?? "").trim();
  if (!text) {
    throw new TypeError("runsDir is required.");
  }
  return path.resolve(text);
}

function isInside(rootDir, targetDir) {
  return targetDir.startsWith(`${rootDir}${path.sep}`);
}

function artifactPath(runsDir, runId, artifact) {
  const fileName = ARTIFACT_FILES[artifact];
  if (!fileName) {
    throw new TypeError(`Unsupported run artifact: ${artifact}`);
  }

  const resolvedRunsDir = path.resolve(runsDir);
  const runDir = path.resolve(resolvedRunsDir, String(runId ?? ""));
  if (!isInside(resolvedRunsDir, runDir)) {
    throw new TypeError("runId resolves outside runsDir.");
  }
  return path.join(runDir, fileName);
}

async function assertRealRunDirInsideRunsDir(runsDir, runDir) {
  const [realRunsDir, realRunDir] = await Promise.all([
    fs.realpath(runsDir),
    fs.realpath(runDir),
  ]);
  if (!isInside(realRunsDir, realRunDir)) {
    throw new TypeError("runId resolves outside runsDir.");
  }
  return realRunDir;
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
      const lexicalPath = artifactPath(resolvedRunsDir, runId, artifact);
      const realRunDir = await assertRealRunDirInsideRunsDir(
        resolvedRunsDir,
        path.dirname(lexicalPath)
      );
      return fs.readFile(path.join(realRunDir, path.basename(lexicalPath)), "utf8");
    },
  };
}

module.exports = {
  ARTIFACT_FILES,
  artifactPath,
  createFilesystemRunReader,
  isInside,
};
