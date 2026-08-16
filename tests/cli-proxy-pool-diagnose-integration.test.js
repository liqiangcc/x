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

test("bin/x delegates diagnose and probe while benchmark and warmup stay legacy", async () => {
  const source = await fs.readFile(BIN, "utf8");
  assert.match(source, /createProxyPoolDiagnoseCommand/);
  assert.match(source, /createProxyPoolProbeCommand/);
  assert.match(source, /if \(action === "diagnose"\)[\s\S]*?await commandProxyPoolDiagnose\(argv\.slice\(1\)\);/);
  assert.match(source, /if \(action === "probe"\)[\s\S]*?await commandProxyPoolProbe\(argv\.slice\(1\)\);/);
  assert.doesNotMatch(source, /report\.target = "eastmoney-kline"/);
  assert.doesNotMatch(source, /async function writeProxyBenchmarkReport/);
  assert.doesNotMatch(source, /proxyBenchmarkReportWriter\.write\(report, "probe"\)/);
  assert.match(source, /proxyBenchmarkReportWriter\.write\(report, "benchmark"\)/);
  assert.match(source, /proxyBenchmarkReportWriter\.write\(report, "warmup"\)/);
  assert.match(source, /if \(action === "benchmark"\)/);
  assert.match(source, /if \(action === "warmup"\)/);
});
