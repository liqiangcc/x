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

test("bin/x proxy pool select validates protocol before filesystem access", async () => {
  const invalidRate = await runCli(["proxy", "pool", "select", "--min-success-rate", "2"]);
  assert.equal(invalidRate.exitCode, 1);
  assert.equal(invalidRate.stdout, "");
  assert.equal(invalidRate.stderr, "--min-success-rate must be between 0 and 1.\n");

  const missingValue = await runCli(["proxy", "pool", "select", "--max-p95-ms"]);
  assert.equal(missingValue.exitCode, 1);
  assert.equal(missingValue.stdout, "");
  assert.equal(missingValue.stderr, "Missing value for --max-p95-ms\n");
});

test("bin/x keeps proxy pool selection orchestration out of the entry file", async () => {
  const source = await fs.readFile(BIN, "utf8");
  assert.match(source, /createProxyPoolSelectCommand/);
  assert.match(source, /await commandProxyPoolSelect\(argv\.slice\(1\)\);/);
  assert.doesNotMatch(source, /writeSelectedProxies/);
  assert.match(source, /if \(action === "status"\)/);
  assert.match(source, /if \(action === "refresh-github"\)/);
  assert.match(source, /if \(action === "benchmark"\)/);
});
