"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const ROOT = path.resolve(__dirname, ".."); const BIN = path.join(ROOT, "bin", "x");
function runCli(args) { return spawnSync(process.execPath, [BIN, ...args], { cwd: ROOT, encoding: "utf8" }); }

test("real CLI preserves kline sync protocol errors", () => {
  for (const { args, error } of [
    { args: ["kline", "sync"], error: "kline sync requires <input_dir|codes.json>\n" },
    { args: ["kline", "sync", "codes.json", "--limit"], error: "Missing value for --limit\n" },
    { args: ["kline", "sync", "codes.json", "--policy", "p", "--engine", "aws"], error: "--policy and --engine cannot be used together.\n" },
  ]) { const r = runCli(args); assert.equal(r.status, 1, args.join(" ")); assert.equal(r.stdout, ""); assert.equal(r.stderr, error); }
});

test("bin/x delegates kline sync and retains shared mapping consumers", async () => {
  const source = await fs.readFile(BIN, "utf8");
  assert.match(source, /createKlineSyncCommand/);
  assert.match(source, /const commandKlineSync = createKlineSyncCommand\(\{ root: ROOT \}\);/);
  assert.match(source, /await commandKlineSync\(rest\);/);
  assert.doesNotMatch(source, /async function commandKlineSync\(/);
  assert.doesNotMatch(source, /function appendKlineSyncOptions\(/);
  assert.match(source, /appendKlineSyncOptions\(args, \{/);
  assert.match(source, /async function commandKlineRetry\(/);
  assert.match(source, /async function commandDaily\(/);
});
