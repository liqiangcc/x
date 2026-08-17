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

test("real CLI preserves kline validate option protocol errors before script execution", () => {
  const result = runCli(["kline", "validate", "--period"]);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "Missing value for --period\n");
});

test("bin/x delegates kline validate, freshness, and retry-queue while daily remains separate", async () => {
  const source = await fs.readFile(BIN, "utf8");
  assert.match(source, /createKlineValidateCommand/);
  assert.match(source, /const commandKlineValidate = createKlineValidateCommand\(\{ root: ROOT \}\);/);
  assert.match(source, /await commandKlineValidate\(rest\);/);
  assert.doesNotMatch(source, /async function commandKlineValidate\(/);
  assert.doesNotMatch(source, /runNodeAllowFailure\("fetch\/check_kline_empty\.js", args\)/);
  assert.match(source, /createKlineFreshnessCommand/);
  assert.match(source, /await commandKlineFreshness\(rest\);/);
  assert.doesNotMatch(source, /async function commandKlineFreshness\(/);
  assert.match(source, /createKlineRetryQueueCommand/);
  assert.match(source, /await commandKlineRetryQueue\(rest\);/);
  assert.doesNotMatch(source, /async function commandKlineRetryQueue\(/);
  assert.match(source, /async function commandDaily\(/);
});
