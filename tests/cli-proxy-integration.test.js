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

test("bin/x delegates the proxy family through one parent CLI adapter", async () => {
  const source = await fs.readFile(BIN, "utf8");
  assert.match(source, /createProxyCommand/);
  assert.match(source, /const commandProxy = createProxyCommand\(\{/);
  assert.match(source, /clashCommand: commandProxyClash/);
  assert.match(source, /poolCommand: commandProxyPool/);
  assert.match(source, /await commandProxy\(\[subcommand, \.\.\.rest\]\);/);
  assert.doesNotMatch(source, /async function commandProxy\(argv\)/);
  assert.match(source, /async function commandProxyPool\(argv\)/);
  assert.doesNotMatch(source, /await commandProxyClash\(argv\)/);
  assert.doesNotMatch(source, /await commandProxyPool\(argv\.slice\(1\)\)/);
});
