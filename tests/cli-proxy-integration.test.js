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
    const result = await execFileAsync(process.execPath, [BIN, ...args], { cwd: ROOT });
    return { ...result, exitCode: 0 };
  } catch (error) {
    return {
      exitCode: error.code,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

test("real proxy parent router preserves clash unknown-command protocol", async () => {
  const unknown = await runCli(["proxy", "unknown"]);
  assert.equal(unknown.exitCode, 1);
  assert.equal(unknown.stdout, "");
  assert.equal(unknown.stderr, "Unknown proxy command: unknown\n");

  const malformed = await runCli(["proxy", "unknown", "--value"]);
  assert.equal(malformed.exitCode, 1);
  assert.equal(malformed.stdout, "");
  assert.equal(malformed.stderr, "Missing value for --value\n");
});

test("real proxy parent router preserves pool unknown-command protocol", async () => {
  const unknown = await runCli(["proxy", "pool", "unknown"]);
  assert.equal(unknown.exitCode, 1);
  assert.equal(unknown.stdout, "");
  assert.equal(unknown.stderr, "Unknown proxy pool command: unknown\n");

  const missing = await runCli(["proxy", "pool"]);
  assert.equal(missing.exitCode, 1);
  assert.equal(missing.stdout, "");
  assert.equal(missing.stderr, "Unknown proxy pool command: \n");
});

test("bin/x delegates the proxy family through parent and pool CLI adapters", async () => {
  const source = await fs.readFile(BIN, "utf8");
  assert.match(source, /createProxyCommand/);
  assert.match(source, /createProxyPoolCommand/);
  assert.match(source, /const commandProxyPool = createProxyPoolCommand\(\{/);
  assert.match(source, /const commandProxy = createProxyCommand\(\{/);
  assert.match(source, /clashCommand: commandProxyClash/);
  assert.match(source, /poolCommand: commandProxyPool/);
  assert.match(source, /await commandProxy\(\[subcommand, \.\.\.rest\]\);/);
  assert.doesNotMatch(source, /async function commandProxy\(argv\)/);
  assert.doesNotMatch(source, /async function commandProxyPool\(argv\)/);
  assert.doesNotMatch(source, /await commandProxyClash\(argv\)/);
  assert.doesNotMatch(source, /await commandProxyPool\(argv\.slice\(1\)\)/);
});
