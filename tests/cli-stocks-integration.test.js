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

test("real CLI preserves stocks protocol errors without launching fetch script", () => {
  const cases = [
    { args: ["stocks", "list"], error: "Unknown stocks command: list\n" },
    { args: ["stocks", "fetch", "--date", "20260817", "--latest"], error: "--date and --latest cannot be used together.\n" },
    { args: ["stocks", "fetch", "--date", "bad"], error: "Invalid date: bad\n" },
    { args: ["stocks", "fetch", "--page-size"], error: "Missing value for --page-size\n" },
  ];

  for (const { args, error } of cases) {
    const result = runCli(args);
    assert.equal(result.status, 1, args.join(" "));
    assert.equal(result.stdout, "", args.join(" "));
    assert.equal(result.stderr, error, args.join(" "));
  }
});

test("bin/x delegates stocks while leaving codes build and daily orchestration scoped for later", async () => {
  const source = await fs.readFile(BIN, "utf8");

  assert.match(source, /createStocksCommand/);
  assert.match(source, /const commandStocks = createStocksCommand\(\{ root: ROOT, outputDir: rel\(DEFAULT_UNIVERSE_DIR\) \}\);/);
  assert.doesNotMatch(source, /async function commandStocks\(/);
  assert.doesNotMatch(source, /runNode\("fetch\/fetch_market_stocks\.js", args\)/);

  assert.match(source, /async function commandCodesBuild\(/);
  assert.match(source, /runNodeAllowFailure\("fetch\/fetch_market_stocks\.js", \[/);
});
