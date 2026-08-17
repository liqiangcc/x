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

test("bin/x proxy pool status validates protocol before docker or candidate access", async () => {
  const result = await runCli(["proxy", "pool", "status", "--unexpected"]);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "Missing value for --unexpected\n");
});

test("bin/x keeps proxy pool status orchestration out of the entry file", async () => {
  const source = await fs.readFile(BIN, "utf8");
  assert.match(source, /createProxyPoolStatusCommand/);
  assert.match(source, /createProxyPoolCommand/);
  assert.match(source, /statusCommand: commandProxyPoolStatus/);
  assert.match(source, /lifecycleCommand: commandProxyPoolLifecycle/);
  assert.match(source, /refreshGithubCommand: commandProxyPoolRefreshGithub/);
  assert.match(source, /selectCommand: commandProxyPoolSelect/);
  assert.doesNotMatch(source, /await commandProxyPoolStatus\(/);
  assert.doesNotMatch(source, /await proxyCompose\(\["ps"\]\);/);
  assert.doesNotMatch(source, /fetchAllProxyCandidates/);
});
