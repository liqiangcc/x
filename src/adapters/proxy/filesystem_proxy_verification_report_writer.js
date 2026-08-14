"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

function createFilesystemProxyVerificationReportWriter({
  root,
  runsDir,
  now = () => new Date(),
} = {}) {
  const resolvedRoot = root ?? process.cwd();
  const resolvedRunsDir = runsDir ?? path.join(resolvedRoot, "runs");

  function rootPath(filePath) {
    return path.isAbsolute(filePath) ? filePath : path.join(resolvedRoot, filePath);
  }

  function relative(filePath) {
    return path.relative(resolvedRoot, filePath).replaceAll(path.sep, "/");
  }

  return {
    async write({ output = null, report } = {}) {
      const runId = now().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
      const outputDir = output
        ? path.dirname(rootPath(output))
        : path.join(resolvedRunsDir, "proxy-verify", runId);
      const outputFile = output ? rootPath(output) : path.join(outputDir, "report.json");
      const availableFile = path.join(outputDir, "available.txt");

      await fs.mkdir(outputDir, { recursive: true });
      await fs.writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      await fs.writeFile(
        availableFile,
        report.available.map((item) => item.proxy).join("\n") +
          (report.available.length ? "\n" : ""),
        "utf8"
      );

      return {
        report: relative(outputFile),
        available: relative(availableFile),
      };
    },
  };
}

module.exports = {
  createFilesystemProxyVerificationReportWriter,
};
