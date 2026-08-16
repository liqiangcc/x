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

test("real CLI preserves codes build protocol errors without launching parser script", () => {
  const cases = [
    { args: ["codes", "build"], error: "codes build requires <pool_dir>\n" },
    { args: ["codes", "build", "data/pool", "--output"], error: "Missing value for --output\n" },
  ];

  for (const { args, error } of cases) {
    const result = runCli(args);
    assert.equal(result.status, 1, args.join(" "));
    assert.equal(result.stdout, "", args.join(" "));
    assert.equal(result.stderr, error, args.join(" "));
  }
});

test("bin/x delegates codes build while leaving kline sync and daily orchestration scoped for later", async () => {
  const source = await fs.readFile(BIN, "utf8");

  assert.match(source, /createCodesBuildCommand/);
  assert.match(source, /const commandCodesBuild = createCodesBuildCommand\(\{ root: ROOT \}\);/);
  assert.doesNotMatch(source, /async function commandCodesBuild\(/);
  assert.doesNotMatch(source, /runNode\("utils\/parse_pool_json\.js", args\)/);

  assert.match(source, /async function commandKlineSync\(/);
  assert.match(source, /runNodeAllowFailure\("fetch\/fetch_market_stocks\.js", \[/);
});
