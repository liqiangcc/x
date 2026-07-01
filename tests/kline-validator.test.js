"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const test = require("node:test");
const { validateKlinePath } = require("../fetch/check_kline_empty");

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(__dirname, "..");

async function runValidator(targetPath) {
  return validateKlinePath({
    period: null,
    targetPath: path.resolve(targetPath),
  });
}

async function runValidatorCli(targetPath) {
  return execFileAsync(process.execPath, [
    path.join(ROOT, "fetch/check_kline_empty.js"),
    targetPath,
    "--json",
  ]);
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
    const summary = await runValidator(dir);
    assert.equal(summary.status, "failed");
    assert.equal(summary.issue_count, 1);
    assert.equal(summary.issues[0].issue, "invalid_ohlc");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("check_kline_empty CLI preserves success and failure exit codes", async () => {
  const okDir = await fs.mkdtemp(path.join(os.tmpdir(), "x-kline-cli-ok-"));
  const badDir = await fs.mkdtemp(path.join(os.tmpdir(), "x-kline-cli-bad-"));
  await fs.writeFile(path.join(okDir, "000020.json"), JSON.stringify({
    code: "000020",
    market: 0,
    period: "daily",
    klines: ["2026-03-25,1,2,3,1,100,1000,1,1,1,1"],
  }));
  await fs.writeFile(path.join(badDir, "000020.json"), JSON.stringify({
    code: "000020",
    market: 0,
    period: "daily",
    klines: ["2026-03-25,1,2,1,3,100,1000,1,1,1,1"],
  }));

  try {
    await assert.doesNotReject(() => runValidatorCli(okDir));
    await assert.rejects(
      () => runValidatorCli(badDir),
      (error) => error.code === 1
    );
  } finally {
    await fs.rm(okDir, { recursive: true, force: true });
    await fs.rm(badDir, { recursive: true, force: true });
  }
});
