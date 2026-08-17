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

test("real CLI preserves kline retry protocol errors before artifact access", () => {
  for (const { args, error } of [
    { args: ["kline", "retry"], error: "kline retry requires <summary.json|failures.json>\n" },
    { args: ["kline", "retry", "summary.json", "--engine"], error: "Missing value for --engine\n" },
  ]) {
    const result = runCli(args);
    assert.equal(result.status, 1, args.join(" "));
    assert.equal(result.stdout, "", args.join(" "));
    assert.equal(result.stderr, error, args.join(" "));
  }
});

test("bin/x delegates kline retry and retry-queue while daily keeps separate orchestration", async () => {
  const source = await fs.readFile(BIN, "utf8");
  assert.match(source, /createKlineRetryCommand/);
  assert.match(source, /const commandKlineRetry = createKlineRetryCommand\(\{ root: ROOT \}\);/);
  assert.match(source, /await commandKlineRetry\(rest\);/);
  assert.doesNotMatch(source, /async function commandKlineRetry\(/);
  assert.doesNotMatch(source, /function extractRetryCodes\(/);
  assert.doesNotMatch(source, /function inferKlineOutputDirFromSummary\(/);
  assert.match(source, /createKlineRetryQueueCommand/);
  assert.match(source, /const commandKlineRetryQueue = createKlineRetryQueueCommand\(\{ root: ROOT \}\);/);
  assert.match(source, /await commandKlineRetryQueue\(rest\);/);
  assert.doesNotMatch(source, /async function commandKlineRetryQueue\(/);
  assert.doesNotMatch(source, /await commandKlineSync\(args\);/);
  assert.match(source, /async function commandDaily\(/);
});
