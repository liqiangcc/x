"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

function resolveRootPath(root, filePath) {
  return path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
}

function createFilesystemLatencyArtifacts({ root } = {}) {
  if (!root) {
    throw new TypeError("root is required.");
  }

  return {
    async read({ config } = {}) {
      const configFile = config
        ? resolveRootPath(root, config)
        : path.join(root, "config", "kline.json");
      try {
        return JSON.parse(await fs.readFile(configFile, "utf8"));
      } catch (error) {
        if (error.code === "ENOENT") {
          return {};
        }
        throw error;
      }
    },

    async write({ output, report } = {}) {
      const outputPath = resolveRootPath(root, output);
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(
        outputPath,
        `${JSON.stringify(report, null, 2)}\n`,
        "utf8"
      );
    },
  };
}

module.exports = {
  createFilesystemLatencyArtifacts,
  resolveRootPath,
};
