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

test("bin/x aws latency routes through the migrated adapter before cloud access", async () => {
  const invalidEngine = await runCli(["aws", "latency", "--engine", "invalid"]);
  assert.equal(invalidEngine.exitCode, 1);
  assert.equal(invalidEngine.stdout, "");
  assert.equal(invalidEngine.stderr, "Invalid latency engine: invalid\n");

  const missingValue = await runCli(["aws", "latency", "--attempts"]);
  assert.equal(missingValue.exitCode, 1);
  assert.equal(missingValue.stdout, "");
  assert.equal(missingValue.stderr, "Missing value for --attempts\n");
});

test("bin/x preserves legacy option validation for unknown aws subcommands", async () => {
  const result = await runCli(["aws", "unknown", "--value"]);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "Missing value for --value\n");
});

test("bin/x keeps latency command orchestration out of the entry file", async () => {
  const source = await fs.readFile(BIN, "utf8");
  assert.match(source, /createAwsLatencyCommand/);
  assert.match(source, /await commandAwsLatency\(argv\.slice\(1\)\);/);
  assert.doesNotMatch(source, /async function commandAwsLatency\(/);
  assert.match(
    source,
    /runLatencyBenchmark\(normalizeLatencyOptions\(rawLatencyOptions, config\)\)/
  );
});
