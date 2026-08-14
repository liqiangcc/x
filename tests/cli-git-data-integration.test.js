"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "x");

function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
}

test("bin/x git status-data is wired through the migrated command", () => {
  const result = runCli(["git", "status-data"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(typeof result.stdout, "string");
});

test("bin/x git commit-data preserves missing run-id error", () => {
  const result = runCli(["git", "commit-data"]);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(
    result.stderr,
    "git commit-data requires --run-id <run_id>\n"
  );
});
