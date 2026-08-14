"use strict";

const { createFilesystemRunReader } = require("./filesystem_run_reader");

function createFilesystemRunCommitContextReader({ runsDir } = {}) {
  const runReader = createFilesystemRunReader({ runsDir });

  return {
    async readCommitContext({ runId } = {}) {
      const run = JSON.parse(
        await runReader.readArtifact({ artifact: "run", runId })
      );

      let quality = { status: "recorded" };
      try {
        quality = JSON.parse(
          await runReader.readArtifact({ artifact: "quality", runId })
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
};
