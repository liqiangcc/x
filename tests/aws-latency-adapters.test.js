"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  createAwsLatencyBenchmarkRunner,
} = require("../src/adapters/aws/aws_latency_benchmark_runner");
const {
  createFilesystemLatencyArtifacts,
} = require("../src/adapters/aws/filesystem_latency_artifacts");

test("latency benchmark runner adapts normalization to the existing capability", async () => {
  const calls = [];
  const normalized = { engine: "aws", attempts: 2 };
  const report = { engine: "aws", results: [] };
  const runner = createAwsLatencyBenchmarkRunner({
    normalizeOptions(options, config) {
      calls.push(["normalize", options, config]);
      return normalized;
    },
    async runBenchmark(options) {
      calls.push(["run", options]);
      return report;
    },
  });

  assert.equal(
    await runner.run({
      config: { lambda_name: "kline-test" },
      options: { attempts: "2", engine: "aws" },
    }),
    report
  );
  assert.deepEqual(calls, [
    ["normalize", { attempts: "2", engine: "aws" }, { lambda_name: "kline-test" }],
    ["run", normalized],
  ]);
});

test("filesystem latency artifacts use the default config and tolerate a missing file", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "x-latency-config-"));
  try {
    const artifacts = createFilesystemLatencyArtifacts({ root });
    assert.deepEqual(await artifacts.read({}), {});

    await fs.mkdir(path.join(root, "config"), { recursive: true });
    await fs.writeFile(
      path.join(root, "config", "kline.json"),
      '{"lambda_name":"from-default"}\n',
      "utf8"
    );
    assert.deepEqual(await artifacts.read({}), { lambda_name: "from-default" });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("filesystem latency artifacts resolve custom config paths and preserve JSON parse errors", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "x-latency-custom-"));
  try {
    const artifacts = createFilesystemLatencyArtifacts({ root });
    await fs.mkdir(path.join(root, "settings"), { recursive: true });
    await fs.writeFile(
      path.join(root, "settings", "latency.json"),
      '{"aws_regions":["ap-northeast-1"]}\n',
      "utf8"
    );
    assert.deepEqual(
      await artifacts.read({ config: "settings/latency.json" }),
      { aws_regions: ["ap-northeast-1"] }
    );

    await fs.writeFile(path.join(root, "settings", "bad.json"), "{bad", "utf8");
    await assert.rejects(
      () => artifacts.read({ config: "settings/bad.json" }),
      SyntaxError
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("filesystem latency artifacts write the historical pretty JSON shape", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "x-latency-output-"));
  try {
    const artifacts = createFilesystemLatencyArtifacts({ root });
    const report = {
      engine: "aws-router",
      results: [{ ok: true, region: "ap-northeast-1" }],
    };
    await artifacts.write({ output: "runs/latency/report.json", report });

    assert.equal(
      await fs.readFile(path.join(root, "runs", "latency", "report.json"), "utf8"),
      `${JSON.stringify(report, null, 2)}\n`
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
