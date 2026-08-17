"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const BIN = path.join(ROOT, "bin", "x");

function runCli(args) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd: ROOT, encoding: "utf8" });
}

test("real CLI preserves sync control protocol errors before lock access", () => {
  for (const { args, error } of [
    { args: ["kline", "sync-status", "--period"], error: "Missing value for --period\n" },
    { args: ["kline", "unlock"], error: "kline unlock requires --period daily|yearly.\n" },
    { args: ["kline", "unlock", "--period", "weekly"], error: "kline unlock requires --period daily|yearly.\n" },
  ]) {
    const result = runCli(args);
    assert.equal(result.status, 1, args.join(" "));
    assert.equal(result.stdout, "", args.join(" "));
    assert.equal(result.stderr, error, args.join(" "));
  }
});

test("bin/x delegates sync-status, unlock, and freshness while retry-queue and daily remain separate", async () => {
  const source = await fs.readFile(BIN, "utf8");
  assert.match(source, /createKlineSyncControlCommand/);
  assert.match(source, /const commandKlineSyncControl = createKlineSyncControlCommand\(\);/);
  assert.match(source, /await commandKlineSyncControl\(subcommand, rest\);/);
  assert.doesNotMatch(source, /async function commandKlineSyncControl\(/);
  assert.doesNotMatch(source, /src\/kline\/sync_lock/);
  assert.match(source, /createKlineFreshnessCommand/);
  assert.match(source, /await commandKlineFreshness\(rest\);/);
  assert.doesNotMatch(source, /async function commandKlineFreshness\(/);
  assert.match(source, /async function commandKlineRetryQueue\(/);
  assert.match(source, /async function commandDaily\(/);
});
