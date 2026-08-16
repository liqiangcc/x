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

test("real CLI preserves pool pull protocol errors without launching the fetch script", () => {
  const cases = [
    { args: ["pool", "pull", "--date", "bad"], error: "Invalid date: bad\n" },
    { args: ["pool", "pull", "--range-days"], error: "Missing value for --range-days\n" },
    { args: ["pool", "pull", "--engine"], error: "Missing value for --engine\n" },
  ];

  for (const { args, error } of cases) {
    const result = runCli(args);
    assert.equal(result.status, 1, args.join(" "));
    assert.equal(result.stdout, "", args.join(" "));
    assert.equal(result.stderr, error, args.join(" "));
  }
});

test("bin/x delegates pool pull while daily keeps its separate pool orchestration", async () => {
  const source = await fs.readFile(BIN, "utf8");

  assert.match(source, /createPoolPullCommand/);
  assert.match(source, /const commandPoolPull = createPoolPullCommand\(\{ root: ROOT \}\);/);
  assert.match(source, /await commandPoolPull\(rest\);/);
  assert.doesNotMatch(source, /async function commandPoolPull\(/);
  assert.doesNotMatch(source, /runNode\("fetch\/pull_pool_task\.js", args\)/);

  // Daily legitimately owns a separate pool-snapshot orchestration and keeps its own failure-aware call.
  assert.match(source, /runNodeAllowFailure\("fetch\/pull_pool_task\.js", poolArgs/);
  assert.match(source, /async function commandCodesBuild\(/);
});
