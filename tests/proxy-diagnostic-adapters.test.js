"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  createFilesystemProxyBenchmarkReportWriter,
  proxyBenchmarkRunId,
} = require("../src/adapters/proxy/filesystem_proxy_benchmark_reports");
const {
  createProxyPoolDiagnosticRunner,
} = require("../src/adapters/proxy/proxy_pool_diagnostic_runner");

test("proxy diagnostic runner maps diagnose options and always closes runtime", async () => {
  const calls = [];
  const runner = createProxyPoolDiagnosticRunner({
    runtimeFactory() {
      calls.push(["create"]);
      return {
        async prepare(options) {
          calls.push(["prepare", options]);
          return { available_count: 2 };
        },
        async close() {
          calls.push(["close"]);
        },
      };
    },
  });

  const report = await runner.run({ concurrency: 8, samples: 40, timeoutMs: 3500 });
  assert.deepEqual(report, { available_count: 2 });
  assert.deepEqual(calls, [
    ["create"],
    ["prepare", {
      concurrency: 8,
      limit: 40,
      minAvailable: 0,
      minSuccessRate: 0,
      timeoutMs: 3500,
    }],
    ["close"],
  ]);
});

test("proxy diagnostic runner closes runtime when prepare fails", async () => {
  const failure = new Error("probe failed");
  let closed = 0;
  const runner = createProxyPoolDiagnosticRunner({
    runtimeFactory() {
      return {
        async prepare() {
          throw failure;
        },
        async close() {
          closed += 1;
        },
      };
    },
  });

  await assert.rejects(() => runner.run({}), (error) => error === failure);
  assert.equal(closed, 1);
});

test("filesystem proxy benchmark writer preserves legacy report path and JSON shape", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "x-proxy-diagnose-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const runsDir = path.join(root, "runs");
  const fixedDate = new Date("2026-01-02T03:04:05.678Z");
  const writer = createFilesystemProxyBenchmarkReportWriter({
    root,
    runsDir,
    now: () => fixedDate,
  });
  const report = { available_count: 2, passed: true };

  const relative = await writer.write(report, "diagnose");
  assert.equal(relative, "runs/proxy-benchmark/20260102T030405Z_diagnose/report.json");
  assert.equal(proxyBenchmarkRunId(fixedDate), "20260102T030405Z");
  const persisted = await fs.readFile(path.join(root, relative), "utf8");
  assert.equal(persisted, `${JSON.stringify(report, null, 2)}\n`);
});
