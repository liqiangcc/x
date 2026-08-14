"use strict";

const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const path = require("node:path");
const { promisify } = require("node:util");
const test = require("node:test");

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(__dirname, "..");
const BIN = path.join(ROOT, "bin", "x");

test("bin/x simulator check uses the real ledger composition and preserves JSON contract", async () => {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [
      BIN,
      "simulator",
      "check",
      "--start-date",
      "20260105",
      "--end-date",
      "20260106",
      "--json",
    ],
    {
      cwd: ROOT,
      maxBuffer: 1024 * 1024,
    }
  );

  assert.equal(stderr, "");
  const result = JSON.parse(stdout);
  assert.equal(result.dataMode, "legacy_approximate");
  assert.equal(result.databasePath, "var/simulator/simulator.db");
  assert.ok(Array.isArray(result.qualityIssues));
  assert.equal(typeof result.tradingDateCount, "number");
  assert.equal(typeof result.universeCount, "number");
  assert.equal(typeof result.universeSource, "string");
});
