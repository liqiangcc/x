"use strict";

const { createFilesystemRunReader } = require("./filesystem_run_reader");

function parseJsonArtifact(content, label) {
  try {
    return JSON.parse(content);
  } catch (error) {
    error.message = `${label}: ${error.message}`;
    throw error;
  }
}

function createFilesystemRunCommitContextReader({ runsDir } = {}) {
  const runReader = createFilesystemRunReader({ runsDir });

  return {
    async readCommitContext({ runId } = {}) {
      const run = parseJsonArtifact(
        await runReader.readArtifact({ artifact: "run", runId }),
        "run.json"
      );

      let quality = { status: "recorded" };
      try {
        quality = parseJsonArtifact(
          await runReader.readArtifact({ artifact: "quality", runId }),
          "quality.json"
        );
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }

      return { quality, run };
    },
  };
}

module.exports = {
  createFilesystemRunCommitContextReader,
  parseJsonArtifact,
};
