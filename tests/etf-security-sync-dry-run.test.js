"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

function writeSnapshot(filePath, records, name) {
  fs.writeFileSync(filePath, JSON.stringify({
    complete: true,
    records,
    source: {
      document: "https://etf.sse.com.cn/fundlist/",
      version: `${name}-v1`,
      collectedAt: "2026-08-13T08:00:00.000Z",
    },
  }, null, 2));
}

test("ETF security master CLI dry-run validates real sync semantics without filesystem writes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "x-etf-sync-dry-run-"));
  try {
    const allSnapshot = path.join(root, "all.json");
    const t0Snapshot = path.join(root, "t0.json");
    writeSnapshot(allSnapshot, [
      { code: "510300", listingDate: "2012-05-28" },
      { code: "511010", listingDate: "2013-03-25" },
    ], "all");
    writeSnapshot(t0Snapshot, [
      { code: "511010" },
    ], "t0");

    const execution = spawnSync(process.execPath, [
      path.join(__dirname, "..", "scripts", "sync_etf_security_master.js"),
      "--exchange", "sse",
      "--all-snapshot", allSnapshot,
      "--t0-snapshot", t0Snapshot,
      "--data-root", root,
      "--dry-run",
    ], {
      cwd: path.join(__dirname, ".."),
      encoding: "utf8",
    });

    assert.equal(execution.status, 0, execution.stderr || execution.stdout);
    const result = JSON.parse(execution.stdout);
    assert.equal(result.ok, true);
    assert.equal(result.validation.summary.recordCount, 2);
    assert.equal(result.validation.summary.profileResolutionCount, 2);
    assert.equal(result.validation.summary.profileResolutionErrorCount, 0);
    assert.equal(result.writes.length, 1);
    assert.deepEqual(result.writes[0], {
      dryRun: true,
      datasetId: "etf_sse",
      recordCount: 2,
      metadata: {
        exchange: "sse",
        source: {
          provider: "sse",
          document: "all=https://etf.sse.com.cn/fundlist/;t0=https://etf.sse.com.cn/fundlist/",
          version: "all=all-v1;t0=t0-v1",
          collectedAt: "2026-08-13T08:00:00.000Z",
          evidence: {
            allContentHash: null,
            t0ContentHash: null,
          },
        },
        summary: {
          etfCount: 2,
          t0Count: 1,
          t1Count: 1,
        },
      },
    });
    assert.equal(fs.existsSync(path.join(root, "security_master")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
