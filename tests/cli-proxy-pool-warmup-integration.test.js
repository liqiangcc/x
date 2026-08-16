"use strict";

const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
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

test("bin/x proxy pool warmup validates protocol before benchmark infrastructure", async () => {
  const invalidDuration = await runCli(["proxy", "pool", "warmup", "--duration", "0m"]);
  assert.equal(invalidDuration.exitCode, 1);
  assert.equal(invalidDuration.stdout, "");
  assert.equal(
    invalidDuration.stderr,
    "Invalid duration: 0m. Use values such as 30s, 30m, or 1h.\n"
  );

  const invalidSamples = await runCli(["proxy", "pool", "warmup", "--samples", "0"]);
  assert.equal(invalidSamples.exitCode, 1);
  assert.equal(invalidSamples.stdout, "");
  assert.equal(invalidSamples.stderr, "--samples must be a positive integer.\n");

  const invalidConcurrency = await runCli(["proxy", "pool", "warmup", "--concurrency", "0"]);
  assert.equal(invalidConcurrency.exitCode, 1);
  assert.equal(invalidConcurrency.stdout, "");
  assert.equal(invalidConcurrency.stderr, "--concurrency must be a positive integer.\n");

  const missingDuration = await runCli(["proxy", "pool", "warmup", "--duration"]);
  assert.equal(missingDuration.exitCode, 1);
  assert.equal(missingDuration.stdout, "");
  assert.equal(missingDuration.stderr, "Missing value for --duration\n");
});

test("warmup migration preserves benchmark protocol validation", async () => {
  const invalidBenchmarkSamples = await runCli(["proxy", "pool", "benchmark", "--samples", "0"]);
  assert.equal(invalidBenchmarkSamples.exitCode, 1);
  assert.equal(invalidBenchmarkSamples.stdout, "");
  assert.equal(invalidBenchmarkSamples.stderr, "--samples must be a positive integer.\n");

  const invalidBenchmarkConcurrency = await runCli(["proxy", "pool", "benchmark", "--concurrency", "0"]);
  assert.equal(invalidBenchmarkConcurrency.exitCode, 1);
  assert.equal(invalidBenchmarkConcurrency.stdout, "");
  assert.equal(invalidBenchmarkConcurrency.stderr, "--concurrency must be a positive integer.\n");
});
