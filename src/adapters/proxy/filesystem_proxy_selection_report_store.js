"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

function createFilesystemProxySelectionReportStore({ root } = {}) {
  const resolvedRoot = root ?? process.cwd();

  function outputFile(output) {
    if (!output) {
      return path.join(resolvedRoot, "var/proxy-pool/selected.json");
    }
    return path.isAbsolute(output) ? output : path.join(resolvedRoot, output);
  }

  function relative(filePath) {
    return path.relative(resolvedRoot, filePath).replaceAll(path.sep, "/");
  }

  return {
    async readPrevious({ output = null } = {}) {
      const filePath = outputFile(output);
      try {
        return {
          report: JSON.parse(await fs.readFile(filePath, "utf8")),
          output: relative(filePath),
        };
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
    },

    async write({ output = null, report } = {}) {
      const filePath = outputFile(output);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const temporary = `${filePath}.${process.pid}.tmp`;
      await fs.writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      await fs.rename(temporary, filePath);
      return { output: relative(filePath) };
    },
  };
}

module.exports = {
  createFilesystemProxySelectionReportStore,
};
