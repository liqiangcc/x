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

test("real AWS parent router preserves legacy unknown-command validation order", async () => {
  const malformed = await runCli(["aws", "unknown", "--value"]);
  assert.equal(malformed.exitCode, 1);
  assert.equal(malformed.stdout, "");
  assert.equal(malformed.stderr, "Missing value for --value\n");

  const unknown = await runCli(["aws", "unknown"]);
  assert.equal(unknown.exitCode, 1);
  assert.equal(unknown.stdout, "");
  assert.equal(unknown.stderr, "Unknown aws command: unknown\n");
});

test("bin/x delegates the AWS family through one parent CLI adapter", async () => {
  const source = await fs.readFile(BIN, "utf8");
  assert.match(source, /createAwsCommand/);
  assert.match(source, /const commandAws = createAwsCommand\(\{/);
  assert.match(source, /probeRouterCommand: commandAwsProbeRouter/);
  assert.match(source, /maintenanceCommand: commandAwsMaintenance/);
  assert.match(source, /latencyCommand: commandAwsLatency/);
  assert.match(source, /await commandAws\(\[subcommand, \.\.\.rest\]\);/);
  assert.doesNotMatch(source, /async function commandAws\(/);
  assert.doesNotMatch(source, /await commandAwsProbeRouter\(/);
  assert.doesNotMatch(source, /await commandAwsMaintenance\(/);
  assert.doesNotMatch(source, /await commandAwsLatency\(/);
});
