"use strict";

const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(__dirname, "..");
const BIN = path.join(ROOT, "bin", "x");

async function runCli(args) {
  try {
    const result = await execFileAsync(process.execPath, [BIN, ...args], {
      cwd: ROOT,
      maxBuffer: 20 * 1024 * 1024,
    });
    return { ...result, exitCode: 0 };
  } catch (error) {
    return {
      exitCode: error.code,
      stderr: error.stderr ?? "",
      stdout: error.stdout ?? "",
    };
  }
}

test("bin/x proxy pool diagnose validates protocol before runtime access", async () => {
  const invalidSamples = await runCli(["proxy", "pool", "diagnose", "--samples", "0"]);
  assert.equal(invalidSamples.exitCode, 1);
  assert.equal(invalidSamples.stdout, "");
  assert.equal(invalidSamples.stderr, "--samples must be a positive integer.\n");

  const missingTimeout = await runCli(["proxy", "pool", "diagnose", "--timeout-ms"]);
  assert.equal(missingTimeout.exitCode, 1);
  assert.equal(missingTimeout.stdout, "");
  assert.equal(missingTimeout.stderr, "Missing value for --timeout-ms\n");
});

test("bin/x delegates proxy pool runtime commands instead of owning their orchestration", async () => {
  const source = await fs.readFile(BIN, "utf8");
  assert.match(source, /createProxyPoolDiagnoseCommand/);
  assert.match(source, /createProxyPoolProbeCommand/);
  assert.match(source, /createProxyPoolBenchmarkCommand/);
  assert.match(source, /createProxyPoolWarmupCommand/);
  assert.match(source, /createProxyPoolCommand/);
  assert.match(source, /diagnoseCommand: commandProxyPoolDiagnose/);
  assert.match(source, /probeCommand: commandProxyPoolProbe/);
  assert.match(source, /benchmarkCommand: commandProxyPoolBenchmark/);
  assert.match(source, /warmupCommand: commandProxyPoolWarmup/);
  assert.doesNotMatch(source, /await commandProxyPoolDiagnose\(/);
  assert.doesNotMatch(source, /await commandProxyPoolProbe\(/);
  assert.doesNotMatch(source, /await commandProxyPoolBenchmark\(/);
  assert.doesNotMatch(source, /await commandProxyPoolWarmup\(/);
  assert.doesNotMatch(source, /report\.target = "eastmoney-kline"/);
  assert.doesNotMatch(source, /async function writeProxyBenchmarkReport/);
  assert.doesNotMatch(source, /proxyBenchmarkReportWriter\.write\(report, "probe"\)/);
  assert.doesNotMatch(source, /proxyBenchmarkReportWriter\.write\(report, "benchmark"\)/);
  assert.doesNotMatch(source, /proxyBenchmarkReportWriter\.write\(report, "warmup"\)/);
  assert.doesNotMatch(source, /rounds\.push\(await runProxyBenchmark/);
});
