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

test("bin/x proxy pool verify validates protocol before proxy infrastructure", async () => {
  const invalidConcurrency = await runCli([
    "proxy", "pool", "verify", "--concurrency", "0",
  ]);
  assert.equal(invalidConcurrency.exitCode, 1);
  assert.equal(invalidConcurrency.stdout, "");
  assert.equal(
    invalidConcurrency.stderr,
    "--concurrency must be a positive integer.\n"
  );

  const missingTimeout = await runCli([
    "proxy", "pool", "verify", "--timeout-ms",
  ]);
  assert.equal(missingTimeout.exitCode, 1);
  assert.equal(missingTimeout.stdout, "");
  assert.equal(missingTimeout.stderr, "Missing value for --timeout-ms\n");
});

test("bin/x keeps proxy verification orchestration out of the entry file", async () => {
  const source = await fs.readFile(BIN, "utf8");
  assert.match(source, /createProxyPoolVerifyCommand/);
  assert.match(source, /createProxyPoolCommand/);
  assert.match(source, /verifyCommand: commandProxyPoolVerify/);
  assert.doesNotMatch(source, /await commandProxyPoolVerify\(/);
  assert.doesNotMatch(source, /async function writeProxyVerificationReport\(/);
  assert.doesNotMatch(source, /validateAllProxies/);
});
