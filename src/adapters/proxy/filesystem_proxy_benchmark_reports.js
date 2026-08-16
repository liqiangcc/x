"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

function proxyBenchmarkRunId(date) {
  return date.toISOString().replaceAll(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function createFilesystemProxyBenchmarkReportWriter({
  root,
  runsDir,
  now = () => new Date(),
  fsApi = fs,
} = {}) {
  const resolvedRoot = root ?? process.cwd();
  const resolvedRunsDir = runsDir ?? path.join(resolvedRoot, "runs");

  return {
    async write(report, kind) {
      const runId = proxyBenchmarkRunId(now());
      const outputDir = path.join(resolvedRunsDir, "proxy-benchmark", `${runId}_${kind}`);
      const outputFile = path.join(outputDir, "report.json");
      await fsApi.mkdir(outputDir, { recursive: true });
      await fsApi.writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      return path.relative(resolvedRoot, outputFile).replaceAll(path.sep, "/");
    },
  };
}

module.exports = {
  createFilesystemProxyBenchmarkReportWriter,
  proxyBenchmarkRunId,
};
