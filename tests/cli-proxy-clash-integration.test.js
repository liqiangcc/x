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

test("bin/x proxy clash validates protocol without touching clash infrastructure", async () => {
  const missingConfig = await runCli(["proxy", "list", "--config"]);
  assert.equal(missingConfig.exitCode, 1);
  assert.equal(missingConfig.stdout, "");
  assert.equal(missingConfig.stderr, "Missing value for --config\n");

  const missingProxy = await runCli(["proxy", "rotate", "--proxy"]);
  assert.equal(missingProxy.exitCode, 1);
  assert.equal(missingProxy.stdout, "");
  assert.equal(missingProxy.stderr, "Missing value for --proxy\n");

  const unknown = await runCli(["proxy", "unknown"]);
  assert.equal(unknown.exitCode, 1);
  assert.equal(unknown.stdout, "");
  assert.equal(unknown.stderr, "Unknown proxy command: unknown\n");
});

test("bin/x delegates clash and proxy-pool commands through dedicated parent adapters", async () => {
  const source = await fs.readFile(BIN, "utf8");

  assert.match(source, /createProxyCommand/);
  assert.match(source, /createProxyClashCommand/);
  assert.match(source, /createProxyPoolCommand/);
  assert.match(source, /clashCommand: commandProxyClash/);
  assert.match(source, /poolCommand: commandProxyPool/);
  assert.doesNotMatch(source, /async function commandProxy\(argv\)/);
  assert.doesNotMatch(source, /async function commandProxyPool\(argv\)/);
  assert.doesNotMatch(source, /await commandProxyClash\(argv\)/);
  assert.doesNotMatch(source, /await commandProxyPool\(argv\.slice\(1\)\)/);
  assert.doesNotMatch(source, /require\("\.\.\/src\/proxy\/clash"\)/);
  assert.doesNotMatch(source, /require\("\.\.\/\.\.\/src\/proxy\/clash"\)/);
});
