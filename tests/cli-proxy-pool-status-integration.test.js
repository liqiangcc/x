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
  assert.match(source, /await commandProxyPoolStatus\(argv\.slice\(1\)\);/);
  assert.doesNotMatch(source, /await proxyCompose\(\["ps"\]\);/);
  assert.doesNotMatch(source, /fetchAllProxyCandidates/);
  assert.match(source, /createProxyPoolLifecycleCommand/);
  assert.match(source, /await commandProxyPoolLifecycle\(argv\);/);
  assert.match(source, /if \(action === "refresh-github"\)/);
  assert.match(source, /await commandProxyPoolSelect\(argv\.slice\(1\)\);/);
});
