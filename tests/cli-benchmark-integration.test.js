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

test("bin/x benchmark routes through the migrated command and preserves protocol errors", async () => {
  const missingCodes = await runCli(["benchmark", "proxy-sync"]);
  assert.equal(missingCodes.exitCode, 1);
  assert.equal(missingCodes.stdout, "");
  assert.equal(
    missingCodes.stderr,
    "benchmark proxy-sync requires --codes <codes.json>.\n"
  );

  const unknown = await runCli(["benchmark", "unknown"]);
  assert.equal(unknown.exitCode, 1);
  assert.equal(unknown.stdout, "");
  assert.equal(unknown.stderr, "Unknown benchmark: unknown\n");
});

test("bin/x keeps benchmark implementation out of the entry file", async () => {
  const source = await fs.readFile(BIN, "utf8");
  assert.match(source, /createBenchmarkCommand/);
  assert.doesNotMatch(source, /async function commandBenchmark\(/);
});
