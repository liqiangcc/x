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

test("real CLI preserves kline aggregate-yearly protocol errors before input access", () => {
  for (const { args, error } of [
    {
      args: ["kline", "aggregate-yearly"],
      error: "kline aggregate-yearly requires <input_dir|codes.json>.\n",
    },
    {
      args: ["kline", "aggregate-yearly", "codes.json"],
      error: "kline aggregate-yearly requires --date YYYYMMDD.\n",
    },
    {
      args: ["kline", "aggregate-yearly", "codes.json", "--date"],
      error: "Missing value for --date\n",
    },
    {
      args: ["kline", "aggregate-yearly", "codes.json", "--date", "20260817", "--concurrency"],
      error: "Missing value for --concurrency\n",
    },
  ]) {
    const result = runCli(args);
    assert.equal(result.status, 1, args.join(" "));
    assert.equal(result.stdout, "", args.join(" "));
    assert.equal(result.stderr, error, args.join(" "));
  }
});

test("bin/x delegates aggregate-yearly while daily keeps its own aggregate and codes dependencies", async () => {
  const source = await fs.readFile(BIN, "utf8");
  assert.match(source, /createKlineAggregateYearlyCommand/);
  assert.match(
    source,
    /const commandKlineAggregateYearly = createKlineAggregateYearlyCommand\(\{ root: ROOT, klineRoot: DEFAULT_KLINE_DIR \}\);/,
  );
  assert.match(source, /await commandKlineAggregateYearly\(rest\);/);
  assert.doesNotMatch(source, /async function commandKlineAggregateYearly\(/);
  assert.doesNotMatch(source, /async function loadCodesInput\(/);
  assert.match(source, /const \{ aggregateYearlyFromDaily \} = require\("\.\.\/src\/kline\/aggregate_yearly"\);/);
  assert.match(source, /async \(\) => aggregateYearlyFromDaily\(\{/);
  assert.match(source, /async function loadCodesJson\(/);
  assert.match(source, /async function commandKlineRetryQueue\(/);
  assert.match(source, /async function commandKlineFreshness\(/);
  assert.match(source, /async function commandDaily\(/);
});
