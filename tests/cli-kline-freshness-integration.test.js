"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const BIN = path.join(ROOT, "bin", "x");

function runCli(args) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: ROOT,
    encoding: "utf8",
  });
}

test("real CLI preserves kline freshness protocol errors before file access", () => {
  for (const { args, error } of [
    {
      args: ["kline", "freshness"],
      error: "kline freshness requires --period daily|yearly.\n",
    },
    {
      args: ["kline", "freshness", "--period", "daily"],
      error: "kline freshness requires --codes <codes.json>.\n",
    },
    {
      args: ["kline", "freshness", "--period", "weekly", "--codes", "codes.json"],
      error: "kline freshness requires --period daily|yearly.\n",
    },
    {
      args: ["kline", "freshness", "--period"],
      error: "Missing value for --period\n",
    },
    {
      args: ["kline", "freshness", "--period", "daily", "--codes"],
      error: "Missing value for --codes\n",
    },
  ]) {
    const result = runCli(args);
    assert.equal(result.status, 1, args.join(" "));
    assert.equal(result.stdout, "", args.join(" "));
    assert.equal(result.stderr, error, args.join(" "));
  }
});

test("bin/x delegates kline freshness and retry-queue while daily remains separate", async () => {
  const source = await fs.readFile(BIN, "utf8");
  assert.match(source, /createKlineFreshnessCommand/);
  assert.match(
    source,
    /const commandKlineFreshness = createKlineFreshnessCommand\(\{ root: ROOT \}\);/,
  );
  assert.match(source, /await commandKlineFreshness\(rest\);/);
  assert.doesNotMatch(source, /async function commandKlineFreshness\(/);
  assert.doesNotMatch(source, /require\("\.\/\.\.\/src\/kline\/freshness"\)/);
  assert.match(source, /createKlineRetryQueueCommand/);
  assert.match(source, /await commandKlineRetryQueue\(rest\);/);
  assert.doesNotMatch(source, /async function commandKlineRetryQueue\(/);
  assert.match(source, /async function commandDaily\(/);
});
