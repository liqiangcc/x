"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const BIN = path.join(ROOT, "bin", "x");

function runWithEmptyPath(args) {
  const emptyPath = fs.mkdtempSync(path.join(os.tmpdir(), "x-empty-path-"));
  try {
    return spawnSync(process.execPath, [BIN, ...args], {
      cwd: ROOT,
      env: { ...process.env, PATH: emptyPath },
      encoding: "utf8",
    });
  } finally {
    fs.rmSync(emptyPath, { recursive: true, force: true });
  }
}

test("bin/x delegates AWS maintenance commands without absorbing latency or probe-router", () => {
  const source = fs.readFileSync(BIN, "utf8");
  assert.equal(source.includes("createAwsMaintenanceCommand"), true);
  assert.equal(source.includes("const commandAwsMaintenance = createAwsMaintenanceCommand({ root: ROOT });"), true);
  assert.equal(source.includes("await commandAwsMaintenance(argv);"), true);
  assert.equal(source.includes("async function commandAwsStatus("), false);
  assert.equal(source.includes("async function commandAwsSyncGithubSecrets("), false);
  assert.equal(source.includes("createAwsLatencyCommand"), true);
  assert.equal(source.includes("const commandAwsLatency = createAwsLatencyCommand({ root: ROOT });"), true);
  assert.equal(source.includes("async function commandAwsLatency("), false);
  assert.equal(source.includes("await commandAwsLatency(argv.slice(1));"), true);
  assert.equal(source.includes("await commandAwsProbeRouter(argv.slice(1));"), true);
});

test("real aws status entry keeps missing-tool diagnostic JSON and exit code", () => {
  const result = runWithEmptyPath(["aws", "status", "--profile", "missing"]);
  assert.equal(result.status, 1);
  assert.equal(result.stderr, "");
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.profile, "missing");
  assert.equal(summary.status, "failed");
  assert.equal(summary.tools.aws.ok, false);
  assert.equal(summary.tools.gh.ok, false);
  assert.deepEqual(summary.credentials, {
    ok: false,
    error: "aws CLI is unavailable.",
  });
  assert.deepEqual(summary.identity, {
    ok: false,
    error: "aws CLI is unavailable.",
  });
  assert.deepEqual(summary.lambda_preflight, {
    ok: false,
    error: "Static AWS profile credentials are required before Lambda preflight.",
  });
});

test("real sync-github-secrets entry fails before any GitHub writes when aws CLI is unavailable", () => {
  const result = runWithEmptyPath([
    "aws",
    "sync-github-secrets",
    "--repo",
    "owner/repo",
  ]);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /aws CLI is not available:/);
});
