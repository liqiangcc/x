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

test("bin/x proxy pool refresh-github validates protocol before provider infrastructure", async () => {
  const invalidTimeout = await runCli(["proxy", "pool", "refresh-github", "--timeout-ms", "0"]);
  assert.equal(invalidTimeout.exitCode, 1);
  assert.equal(invalidTimeout.stdout, "");
  assert.equal(invalidTimeout.stderr, "--timeout-ms must be a positive integer.\n");

  const missingTimeout = await runCli(["proxy", "pool", "refresh-github", "--timeout-ms"]);
  assert.equal(missingTimeout.exitCode, 1);
  assert.equal(missingTimeout.stdout, "");
  assert.equal(missingTimeout.stderr, "Missing value for --timeout-ms\n");
});

test("bin/x delegates refresh-github without owning provider orchestration", async () => {
  const source = await fs.readFile(BIN, "utf8");
  assert.match(source, /createProxyPoolRefreshGithubCommand/);
  assert.match(source, /await commandProxyPoolRefreshGithub\(argv\.slice\(1\)\);/);
  assert.doesNotMatch(source, /GithubProxyRepositoryProvider/);
  assert.doesNotMatch(source, /provider\.listCandidates\(\)/);
  assert.match(source, /createProxyPoolLifecycleCommand/);
  assert.match(source, /await commandProxyPoolLifecycle\(argv\);/);
  assert.doesNotMatch(source, /if \(action === "up"\)/);
  assert.doesNotMatch(source, /if \(action === "down"\)/);
  assert.match(source, /createProxyPoolDiagnoseCommand/);
  assert.match(source, /if \(action === "diagnose"\)[\s\S]*?await commandProxyPoolDiagnose\(argv\.slice\(1\)\);/);
});
