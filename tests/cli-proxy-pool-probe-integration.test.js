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

test("bin/x proxy pool probe validates protocol before runtime access", async () => {
  const invalidDuration = await runCli(["proxy", "pool", "probe", "--duration", "0m"]);
  assert.equal(invalidDuration.exitCode, 1);
  assert.equal(invalidDuration.stdout, "");
  assert.equal(
    invalidDuration.stderr,
    "Invalid duration: 0m. Use values such as 30s, 30m, or 1h.\n"
  );

  const invalidSamples = await runCli(["proxy", "pool", "probe", "--samples", "0"]);
  assert.equal(invalidSamples.exitCode, 1);
  assert.equal(invalidSamples.stdout, "");
  assert.equal(invalidSamples.stderr, "--samples must be a positive integer.\n");

  const missingDeadline = await runCli(["proxy", "pool", "probe", "--hard-deadline-ms"]);
  assert.equal(missingDeadline.exitCode, 1);
  assert.equal(missingDeadline.stdout, "");
  assert.equal(missingDeadline.stderr, "Missing value for --hard-deadline-ms\n");
});
