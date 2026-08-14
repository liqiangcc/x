"use strict";

const { execFile } = require("node:child_process");
const path = require("node:path");
const { promisify } = require("node:util");

function createNodeProxySyncBenchmarkRunner({
  root,
  execFileAsync = promisify(execFile),
  nowMs = () => Date.now(),
} = {}) {
  const resolvedRoot = path.resolve(root);

  return {
    async run({
      codes,
      expectedLatestDate = null,
      outputDir,
      period = "daily",
      samples = "100",
    } = {}) {
      const args = [
        codes,
        "--period",
        period,
        "--policy",
        "proxy-only",
        "--refresh-mode",
        "incremental",
        "--limit",
        String(samples),
        "--output-dir",
        outputDir,
        "--concurrency",
        "auto",
        "--retry-attempts",
        "0",
        "--proxy-preflight",
      ];
      if (expectedLatestDate) {
        args.push(
          "--expected-latest-date",
          expectedLatestDate,
          "--freshness-codes",
          codes
        );
      }

      const startedAt = nowMs();
      try {
        const result = await execFileAsync(
          "node",
          [path.join(resolvedRoot, "fetch/query_pool_klines.js"), ...args],
          {
            cwd: resolvedRoot,
            env: process.env,
            maxBuffer: 50 * 1024 * 1024,
          }
        );
        return {
          durationMs: nowMs() - startedAt,
          exitCode: 0,
          stderr: result.stderr ?? "",
          stdout: result.stdout ?? "",
        };
      } catch (error) {
        return {
          durationMs: nowMs() - startedAt,
          exitCode: typeof error.code === "number" ? error.code : 1,
          stderr: error.stderr ?? error.message,
          stdout: error.stdout ?? "",
        };
      }
    },
  };
}

module.exports = {
  createNodeProxySyncBenchmarkRunner,
};
