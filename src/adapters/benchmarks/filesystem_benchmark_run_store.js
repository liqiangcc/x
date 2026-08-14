"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

function formatRunId(date = new Date()) {
  return date
    .toISOString()
    .replaceAll(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function relativeTo(root, filePath) {
  return path.relative(root, filePath).replaceAll(path.sep, "/");
}

function createFilesystemBenchmarkRunStore({
  root,
  runsDir,
  now = () => new Date(),
} = {}) {
  const resolvedRoot = path.resolve(root);
  const resolvedRunsDir = path.resolve(runsDir);

  return {
    async createRun({ kind } = {}) {
      const text = String(kind ?? "").trim();
      if (!text) throw new TypeError("benchmark kind is required.");
      const runDir = path.join(
        resolvedRunsDir,
        "benchmark",
        text,
        formatRunId(now())
      );
      await fs.mkdir(runDir, { recursive: true });
      return {
        outputDir: path.join(runDir, "data"),
        runDir,
      };
    },

    async readSummary({ run, period } = {}) {
      const summaryPath = path.join(
        run.runDir,
        "data",
        period,
        `summary.${period}.json`
      );
      try {
        return JSON.parse(await fs.readFile(summaryPath, "utf8"));
      } catch {
        return null;
      }
    },

    async writeReport({ run, report } = {}) {
      const reportFile = path.join(run.runDir, "report.json");
      await fs.writeFile(
        reportFile,
        `${JSON.stringify(report, null, 2)}\n`,
        "utf8"
      );
      return relativeTo(resolvedRoot, reportFile);
    },
  };
}

module.exports = {
  createFilesystemBenchmarkRunStore,
  formatRunId,
  relativeTo,
};
