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

test("bin/x proxy pool lifecycle validates protocol before docker compose access", async () => {
  const up = await runCli(["proxy", "pool", "up", "--unexpected"]);
  assert.equal(up.exitCode, 1);
  assert.equal(up.stdout, "");
  assert.equal(up.stderr, "Missing value for --unexpected\n");

  const down = await runCli(["proxy", "pool", "down", "--unexpected"]);
  assert.equal(down.exitCode, 1);
  assert.equal(down.stdout, "");
  assert.equal(down.stderr, "Missing value for --unexpected\n");
});

test("bin/x delegates proxy pool lifecycle and no longer owns docker compose infrastructure", async () => {
  const source = await fs.readFile(BIN, "utf8");
  assert.match(source, /createProxyPoolLifecycleCommand/);
  assert.match(source, /createProxyPoolCommand/);
  assert.match(source, /lifecycleCommand: commandProxyPoolLifecycle/);
  assert.match(source, /diagnoseCommand: commandProxyPoolDiagnose/);
  assert.match(source, /probeCommand: commandProxyPoolProbe/);
  assert.match(source, /benchmarkCommand: commandProxyPoolBenchmark/);
  assert.match(source, /warmupCommand: commandProxyPoolWarmup/);
  assert.doesNotMatch(source, /await commandProxyPoolLifecycle\(/);
  assert.doesNotMatch(source, /async function proxyCompose/);
  assert.doesNotMatch(source, /await proxyCompose\(/);
});
