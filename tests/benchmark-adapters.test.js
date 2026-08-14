"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  createFilesystemBenchmarkRunStore,
  formatRunId,
} = require("../src/adapters/benchmarks/filesystem_benchmark_run_store");
const {
  createNodeProxySyncBenchmarkRunner,
} = require("../src/adapters/benchmarks/node_proxy_sync_benchmark_runner");

test("filesystem benchmark run store preserves run layout and report paths", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "x-benchmark-store-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const runsDir = path.join(root, "runs");
  const fixed = new Date("2026-08-14T20:00:01.234Z");
  const store = createFilesystemBenchmarkRunStore({
    root,
    runsDir,
    now: () => fixed,
  });

  const run = await store.createRun({ kind: "proxy-sync" });
  assert.equal(formatRunId(fixed), "20260814T200001Z");
  assert.equal(
    run.runDir,
    path.join(runsDir, "benchmark", "proxy-sync", "20260814T200001Z")
  );
  assert.equal(run.outputDir, path.join(run.runDir, "data"));

  await fs.mkdir(path.join(run.outputDir, "daily"), { recursive: true });
  await fs.writeFile(
    path.join(run.outputDir, "daily", "summary.daily.json"),
    `${JSON.stringify({ status: "completed" })}\n`,
    "utf8"
  );
  assert.deepEqual(await store.readSummary({ run, period: "daily" }), {
    status: "completed",
  });

  const reportPath = await store.writeReport({
    run,
    report: { benchmark: "proxy-sync" },
  });
  assert.equal(
    reportPath,
    "runs/benchmark/proxy-sync/20260814T200001Z/report.json"
  );
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(run.runDir, "report.json"), "utf8")),
    { benchmark: "proxy-sync" }
  );
});

test("filesystem benchmark run store preserves legacy summary read fallback", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "x-benchmark-summary-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = createFilesystemBenchmarkRunStore({
    root,
    runsDir: path.join(root, "runs"),
    now: () => new Date("2026-08-14T20:00:00Z"),
  });
  const run = await store.createRun({ kind: "proxy-sync" });
  assert.equal(await store.readSummary({ run, period: "daily" }), null);
  await fs.mkdir(path.join(run.outputDir, "daily"), { recursive: true });
  await fs.writeFile(
    path.join(run.outputDir, "daily", "summary.daily.json"),
    "{broken\n",
    "utf8"
  );
  assert.equal(await store.readSummary({ run, period: "daily" }), null);
});

test("node proxy sync runner owns child process arguments and timing", async () => {
  const calls = [];
  const times = [100, 145];
  const runner = createNodeProxySyncBenchmarkRunner({
    root: "/repo",
    nowMs: () => times.shift(),
    async execFileAsync(command, args, options) {
      calls.push({ command, args, options });
      return { stdout: "ok", stderr: "" };
    },
  });

  const result = await runner.run({
    codes: "/repo/codes.json",
    expectedLatestDate: "20260814",
    outputDir: "/repo/runs/one/data",
    period: "daily",
    samples: "25",
  });

  assert.equal(result.durationMs, 45);
  assert.equal(result.exitCode, 0);
  assert.equal(calls[0].command, "node");
  assert.equal(calls[0].options.cwd, path.resolve("/repo"));
  assert.deepEqual(calls[0].args, [
    path.join(path.resolve("/repo"), "fetch/query_pool_klines.js"),
    "/repo/codes.json",
    "--period",
    "daily",
    "--policy",
    "proxy-only",
    "--refresh-mode",
    "incremental",
    "--limit",
    "25",
    "--output-dir",
    "/repo/runs/one/data",
    "--concurrency",
    "auto",
    "--retry-attempts",
    "0",
    "--proxy-preflight",
    "--expected-latest-date",
    "20260814",
    "--freshness-codes",
    "/repo/codes.json",
  ]);
});

test("node proxy sync runner converts child failures into legacy result shape", async () => {
  const times = [10, 30];
  const runner = createNodeProxySyncBenchmarkRunner({
    root: "/repo",
    nowMs: () => times.shift(),
    async execFileAsync() {
      const error = new Error("failed");
      error.code = 4;
      error.stdout = "partial";
      error.stderr = "boom";
      throw error;
    },
  });
  const result = await runner.run({
    codes: "/repo/codes.json",
    outputDir: "/repo/runs/one/data",
  });
  assert.deepEqual(result, {
    durationMs: 20,
    exitCode: 4,
    stderr: "boom",
    stdout: "partial",
  });
});
