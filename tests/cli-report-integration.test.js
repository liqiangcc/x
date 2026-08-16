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

test("real CLI preserves report protocol errors without reaching report generation", () => {
  const cases = [
    { args: ["report", "weekly"], error: "Unknown report command: weekly\n" },
    { args: ["report", "daily"], error: "report daily requires --date <YYYYMMDD>\n" },
    { args: ["report", "daily", "--date"], error: "Missing value for --date\n" },
    { args: ["report", "daily", "--date", "bad"], error: "Invalid date: bad\n" },
  ];

  for (const { args, error } of cases) {
    const result = runCli(args);
    assert.equal(result.status, 1, args.join(" "));
    assert.equal(result.stdout, "", args.join(" "));
    assert.equal(result.stderr, error, args.join(" "));
  }
});

test("bin/x delegates report family and no longer owns report generation", async () => {
  const source = await fs.readFile(BIN, "utf8");

  assert.match(source, /createReportCommand/);
  assert.match(source, /const commandReport = createReportCommand\(/);
  assert.match(source, /await commandReport\(\[subcommand, \.\.\.rest\]\);/);
  assert.doesNotMatch(source, /async function commandReport\(/);
  assert.doesNotMatch(source, /const \{ generateDailyReport \} = require\("\.\.\/src\/reports\/daily"\);/);
  assert.doesNotMatch(source, /generateDailyReport\(\{/);
});
