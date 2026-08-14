"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ALL_HASH = `sha256:${"a".repeat(64)}`;
const T0_HASH = `sha256:${"b".repeat(64)}`;

function writeSnapshot(filePath, records, name, contentHash) {
  fs.writeFileSync(filePath, JSON.stringify({
    complete: true,
    records,
    source: {
      document: "https://etf.sse.com.cn/fundlist/",
      version: `${name}-v1`,
      collectedAt: "2026-08-13T08:00:00.000Z",
      contentHash,
    },
  }, null, 2));
}

function fixture(root) {
  const allSnapshot = path.join(root, "all.json");
  const t0Snapshot = path.join(root, "t0.json");
  writeSnapshot(allSnapshot, [
    { code: "510300", listingDate: "2012-05-28" },
    { code: "511010", listingDate: "2013-03-25" },
  ], "all", ALL_HASH);
  writeSnapshot(t0Snapshot, [
    { code: "511010" },
  ], "t0", T0_HASH);
  return { allSnapshot, t0Snapshot };
}

function runSync(root, snapshots, extraArgs = []) {
  return spawnSync(process.execPath, [
    path.join(__dirname, "..", "scripts", "sync_etf_security_master.js"),
    "--exchange", "sse",
    "--all-snapshot", snapshots.allSnapshot,
    "--t0-snapshot", snapshots.t0Snapshot,
    "--data-root", root,
    ...extraArgs,
  ], {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8",
  });
}

function applyGuardArgs(overrides = {}) {
  const values = {
    expectedEtfCount: "2",
    expectedT0Count: "1",
    expectedAllContentHash: ALL_HASH,
    expectedT0ContentHash: T0_HASH,
    ...overrides,
  };
  return [
    "--apply",
    "--expected-etf-count", values.expectedEtfCount,
    "--expected-t0-count", values.expectedT0Count,
    "--expected-all-content-hash", values.expectedAllContentHash,
    "--expected-t0-content-hash", values.expectedT0ContentHash,
  ];
}

test("ETF security master CLI defaults to dry-run and performs zero filesystem writes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "x-etf-sync-dry-run-"));
  try {
    const snapshots = fixture(root);
    const execution = runSync(root, snapshots);

    assert.equal(execution.status, 0, execution.stderr || execution.stdout);
    const result = JSON.parse(execution.stdout);
    assert.equal(result.ok, true);
    assert.equal(result.mode, "dry_run");
    assert.equal(result.applyGuard, null);
    assert.equal(result.postWriteValidation, null);
    assert.equal(result.validation.summary.recordCount, 2);
    assert.equal(result.validation.summary.profileResolutionCount, 2);
    assert.equal(result.validation.summary.profileResolutionErrorCount, 0);
    assert.equal(result.writes.length, 1);
    assert.equal(result.writes[0].dryRun, true);
    assert.equal(result.writes[0].datasetId, "etf_sse");
    assert.equal(result.writes[0].recordCount, 2);
    assert.equal(fs.existsSync(path.join(root, "security_master")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("ETF security master CLI keeps --dry-run as an explicit no-write alias", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "x-etf-sync-dry-run-explicit-"));
  try {
    const snapshots = fixture(root);
    const execution = runSync(root, snapshots, ["--dry-run"]);
    assert.equal(execution.status, 0, execution.stderr || execution.stdout);
    assert.equal(JSON.parse(execution.stdout).mode, "dry_run");
    assert.equal(fs.existsSync(path.join(root, "security_master")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("ETF security master CLI refuses apply without the complete acceptance guard", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "x-etf-sync-apply-missing-guard-"));
  try {
    const snapshots = fixture(root);
    const execution = runSync(root, snapshots, ["--apply"]);
    assert.notEqual(execution.status, 0);
    assert.match(execution.stderr, /expected-etf-count is required for --apply/);
    assert.equal(fs.existsSync(path.join(root, "security_master")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("ETF security master CLI refuses apply when accepted count or hash no longer matches", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "x-etf-sync-apply-mismatch-"));
  try {
    const snapshots = fixture(root);
    const execution = runSync(root, snapshots, applyGuardArgs({ expectedEtfCount: "3" }));
    assert.notEqual(execution.status, 0);
    assert.match(execution.stderr, /apply guard mismatch: ETF count expected 3, got 2/);
    assert.equal(fs.existsSync(path.join(root, "security_master")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("ETF security master CLI applies only with exact guards and revalidates persisted ledger", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "x-etf-sync-apply-"));
  try {
    const snapshots = fixture(root);
    const execution = runSync(root, snapshots, applyGuardArgs());

    assert.equal(execution.status, 0, execution.stderr || execution.stdout);
    const result = JSON.parse(execution.stdout);
    assert.equal(result.ok, true);
    assert.equal(result.mode, "apply");
    assert.deepEqual(result.applyGuard, {
      expectedEtfCount: 2,
      expectedT0Count: 1,
      expectedAllContentHash: ALL_HASH,
      expectedT0ContentHash: T0_HASH,
    });
    assert.equal(result.validation.ok, true);
    assert.equal(result.validation.summary.recordCount, 2);
    assert.equal(result.writes.length, 1);
    assert.equal(result.writes[0].datasetId, "etf_sse");
    assert.equal(result.writes[0].recordCount, 2);
    assert.equal(result.postWriteValidation.ok, true);
    assert.equal(result.postWriteValidation.summary.recordCount, 2);
    assert.equal(result.postWriteValidation.summary.profileResolutionCount, 2);
    assert.equal(result.postWriteValidation.summary.profileResolutionErrorCount, 0);

    const recordPath = path.join(root, "security_master", "records", "etf_sse.json");
    const manifestPath = path.join(root, "security_master", "manifest.json");
    assert.equal(fs.existsSync(recordPath), true);
    assert.equal(fs.existsSync(manifestPath), true);
    const recordFile = JSON.parse(fs.readFileSync(recordPath, "utf8"));
    assert.equal(recordFile.datasetId, "etf_sse");
    assert.equal(recordFile.records.length, 2);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    assert.deepEqual(manifest.recordSets, [{
      kind: "record_file",
      path: "security_master/records/etf_sse.json",
    }]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("ETF security master CLI rejects simultaneous --dry-run and --apply", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "x-etf-sync-mode-conflict-"));
  try {
    const snapshots = fixture(root);
    const execution = runSync(root, snapshots, ["--dry-run", "--apply"]);
    assert.notEqual(execution.status, 0);
    assert.match(execution.stderr, /mutually exclusive/);
    assert.equal(fs.existsSync(path.join(root, "security_master")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
