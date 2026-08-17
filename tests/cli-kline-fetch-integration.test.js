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

test("real CLI preserves kline fetch protocol errors before launching fetch script", () => {
  for (const { args, error } of [
    { args: ["kline", "fetch"], error: "kline fetch requires <code_or_secid>\n" },
    { args: ["kline", "fetch", "1.600519", "--output"], error: "Missing value for --output\n" },
    {
      args: ["kline", "fetch", "1.600519", "--policy", "proxy-only", "--engine", "aws"],
      error: "--policy and --engine cannot be used together.\n",
    },
  ]) {
    const result = runCli(args);
    assert.equal(result.status, 1, args.join(" "));
    assert.equal(result.stdout, "", args.join(" "));
    assert.equal(result.stderr, error, args.join(" "));
  }
});

test("bin/x delegates kline fetch, aggregate, and retry-queue while daily remains separate", async () => {
  const source = await fs.readFile(BIN, "utf8");
  assert.match(source, /createKlineFetchCommand/);
  assert.match(source, /const commandKlineFetch = createKlineFetchCommand\(\{ root: ROOT \}\);/);
  assert.match(source, /await commandKlineFetch\(rest\);/);
  assert.doesNotMatch(source, /async function commandKlineFetch\(/);
  assert.doesNotMatch(source, /runNode\("fetch\/fetch_kline\.js", args\)/);

  assert.match(source, /createKlineAggregateYearlyCommand/);
  assert.match(source, /await commandKlineAggregateYearly\(rest\);/);
  assert.doesNotMatch(source, /async function commandKlineAggregateYearly\(/);

  assert.match(source, /createKlineRetryQueueCommand/);
  assert.match(source, /const commandKlineRetryQueue = createKlineRetryQueueCommand\(\{ root: ROOT \}\);/);
  assert.match(source, /await commandKlineRetryQueue\(rest\);/);
  assert.doesNotMatch(source, /async function commandKlineRetryQueue\(/);
  assert.match(source, /async function commandDaily\(/);
});
