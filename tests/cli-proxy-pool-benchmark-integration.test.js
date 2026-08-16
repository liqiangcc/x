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

test("bin/x proxy pool benchmark validates protocol before benchmark infrastructure", async () => {
  const invalidSamples = await runCli(["proxy", "pool", "benchmark", "--samples", "0"]);
  assert.equal(invalidSamples.exitCode, 1);
  assert.equal(invalidSamples.stdout, "");
  assert.equal(invalidSamples.stderr, "--samples must be a positive integer.\n");

  const invalidConcurrency = await runCli(["proxy", "pool", "benchmark", "--concurrency", "0"]);
  assert.equal(invalidConcurrency.exitCode, 1);
  assert.equal(invalidConcurrency.stdout, "");
  assert.equal(invalidConcurrency.stderr, "--concurrency must be a positive integer.\n");

  const missingSamples = await runCli(["proxy", "pool", "benchmark", "--samples"]);
  assert.equal(missingSamples.exitCode, 1);
  assert.equal(missingSamples.stdout, "");
  assert.equal(missingSamples.stderr, "Missing value for --samples\n");
});

test("benchmark migration must preserve warmup protocol validation", async () => {
  const invalidWarmupSamples = await runCli(["proxy", "pool", "warmup", "--samples", "0"]);
  assert.equal(invalidWarmupSamples.exitCode, 1);
  assert.equal(invalidWarmupSamples.stdout, "");
  assert.equal(invalidWarmupSamples.stderr, "--samples must be a positive integer.\n");

  const invalidWarmupDuration = await runCli(["proxy", "pool", "warmup", "--duration", "0m"]);
  assert.equal(invalidWarmupDuration.exitCode, 1);
  assert.equal(invalidWarmupDuration.stdout, "");
  assert.equal(
    invalidWarmupDuration.stderr,
    "Invalid duration: 0m. Use values such as 30s, 30m, or 1h.\n"
  );
});
