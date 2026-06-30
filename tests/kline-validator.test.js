"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const test = require("node:test");

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(__dirname, "..");

async function runValidator(targetPath) {
  const { stdout } = await execFileAsync("node", [
    path.join(ROOT, "fetch/check_kline_empty.js"),
    targetPath,
    "--json",
  ]);
  return JSON.parse(stdout);
}

test("check_kline_empty accepts deterministic sharded kline payloads", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "x-kline-ok-"));
  await fs.writeFile(path.join(dir, "000020.json"), JSON.stringify({
    code: "000020",
    market: 0,
    period: "daily",
    klines: ["2026-03-25,1,2,3,1,100,1000,1,1,1,1"],
  }));

  try {
    const summary = await runValidator(dir);
    assert.equal(summary.status, "ok");
    assert.equal(summary.issue_count, 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("check_kline_empty reports invalid OHLC rows", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "x-kline-bad-"));
  await fs.writeFile(path.join(dir, "000020.json"), JSON.stringify({
    code: "000020",
    market: 0,
    period: "daily",
    klines: ["2026-03-25,1,2,1,3,100,1000,1,1,1,1"],
  }));

  try {
    await assert.rejects(() => runValidator(dir));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
