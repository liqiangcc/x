"use strict";

const {
  createFilesystemRunFileReader,
} = require("./filesystem_run_reader");

function createFilesystemRunCommitContextReader({ runsDir } = {}) {
  const fileReader = createFilesystemRunFileReader({ runsDir });

  return {
    async readCommitContext({ runId } = {}) {
      const run = JSON.parse(
        await fileReader.readFile({ fileName: "run.json", runId })
      );

      let quality = { status: "recorded" };
      try {
        quality = JSON.parse(
          await fileReader.readFile({ fileName: "quality.json", runId })
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
