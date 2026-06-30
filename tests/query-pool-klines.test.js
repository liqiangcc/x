"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { parseArguments, queryPoolKlines } = require("../fetch/query_pool_klines");

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function makeTempDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "query-pool-klines-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

async function writeCodes(filePath, codes) {
  await fs.writeFile(filePath, `${JSON.stringify({ codes }, null, 2)}\n`, "utf8");
}

function klinePayload(code, engine = "aws", region = "ap-northeast-1") {
  return {
    source_engine: engine,
    source_region: region,
    data: {
      code,
      market: code.startsWith("6") ? 1 : 0,
      klines: ["2026-06-30,1,2,3,1,100,200,0,0,0,0"],
    },
  };
}

test("queryPoolKlines handles concurrent success, failure, and skipped files", async (t) => {
  const dir = await makeTempDir(t);
  const inputPath = path.join(dir, "codes.json");
  const outputDir = path.join(dir, "kline");
  await writeCodes(inputPath, ["600001", "600002", "600003", "600004"]);

  const existingPath = path.join(outputDir, "daily", "600", "600004.json");
  await fs.mkdir(path.dirname(existingPath), { recursive: true });
  await fs.writeFile(
    existingPath,
    `${JSON.stringify({ code: "600004", market: 1, period: "daily", klines: [] }, null, 2)}\n`,
    "utf8"
  );

  const options = parseArguments([
    inputPath,
    "--period",
    "daily",
    "--engine",
    "aws",
    "--output-dir",
    outputDir,
    "--concurrency",
    "2",
  ]);
  const requested = [];
  const regionStartIndexes = [];
  let active = 0;
  let maxActive = 0;
  const fetcher = async (secid, fetchOptions) => {
    requested.push(secid);
    regionStartIndexes.push(fetchOptions.awsRegionStartIndex);
    active += 1;
    maxActive = Math.max(maxActive, active);
    try {
      await delay(20);
      if (secid === "1.600002") {
        throw new Error("upstream failed");
      }
      if (secid === "1.600003") {
        return klinePayload("600003", "local", null);
      }
      return klinePayload("600001", "aws", "ap-northeast-1");
    } finally {
      active -= 1;
    }
  };

  const { exitCode, summary } = await queryPoolKlines(options, fetcher);

  assert.equal(exitCode, 1);
  assert.equal(maxActive, 2);
  assert.deepEqual(requested.sort(), ["1.600001", "1.600002", "1.600003"]);
  assert.deepEqual(regionStartIndexes.sort((left, right) => left - right), [0, 1, 2]);
  assert.equal(summary.total_codes, 4);
  assert.equal(summary.success, 2);
  assert.equal(summary.failed, 1);
  assert.equal(summary.skipped_existing, 1);
  assert.equal(summary.success_rate, 0.5);
  assert.deepEqual(summary.engine_counts, { aws: 1, local: 1 });
  assert.deepEqual(summary.region_counts, { "ap-northeast-1": 1 });
  assert.equal(summary.aws_region_strategy, "round_robin_start_index");
  assert.deepEqual(summary.failure_reasons, ["failed_items"]);
  assert.equal(summary.files["600004"].status, "skipped_existing");
});

test("queryPoolKlines force refreshes existing output files", async (t) => {
  const dir = await makeTempDir(t);
  const inputPath = path.join(dir, "codes.json");
  const outputDir = path.join(dir, "kline");
  await writeCodes(inputPath, ["600004"]);

  const existingPath = path.join(outputDir, "daily", "600", "600004.json");
  await fs.mkdir(path.dirname(existingPath), { recursive: true });
  await fs.writeFile(
    existingPath,
    `${JSON.stringify({ code: "600004", market: 1, period: "daily", klines: [] }, null, 2)}\n`,
    "utf8"
  );

  const options = parseArguments([
    inputPath,
    "--period",
    "daily",
    "--engine",
    "aws",
    "--output-dir",
    outputDir,
    "--force",
  ]);
  let calls = 0;
  const { exitCode, summary } = await queryPoolKlines(options, async () => {
    calls += 1;
    return klinePayload("600004", "aws", "ap-northeast-1");
  });

  assert.equal(exitCode, 0);
  assert.equal(calls, 1);
  assert.equal(summary.success, 1);
  assert.equal(summary.skipped_existing, 0);
  assert.equal(summary.files["600004"].status, "success");
});

test("queryPoolKlines enforces min success rate", async (t) => {
  const dir = await makeTempDir(t);
  const inputPath = path.join(dir, "codes.json");
  const outputDir = path.join(dir, "kline");
  await writeCodes(inputPath, ["600001", "600002"]);

  const passingOptions = parseArguments([
    inputPath,
    "--period",
    "daily",
    "--engine",
    "aws",
    "--output-dir",
    outputDir,
    "--force",
    "--min-success-rate",
    "0.8",
  ]);
  const passing = await queryPoolKlines(passingOptions, async (secid) =>
    klinePayload(secid.split(".")[1], "aws", "ap-northeast-1")
  );

  assert.equal(passing.exitCode, 0);
  assert.equal(passing.summary.status, "completed");

  const failingOptions = parseArguments([
    inputPath,
    "--period",
    "daily",
    "--engine",
    "aws",
    "--output-dir",
    path.join(dir, "kline-failing"),
    "--force",
    "--min-success-rate",
    "0.8",
  ]);
  const failing = await queryPoolKlines(failingOptions, async (secid) => {
    if (secid === "1.600002") {
      throw new Error("upstream failed");
    }
    return klinePayload("600001", "aws", "ap-northeast-1");
  });

  assert.equal(failing.exitCode, 1);
  assert.equal(failing.summary.success_rate, 0.5);
  assert.equal(failing.summary.status, "failed_success_rate");
  assert.deepEqual(failing.summary.failure_reasons, [
    "failed_items",
    "success_rate_below_minimum",
  ]);
});

test("queryPoolKlines fails AWS min-rate runs with zero AWS successes", async (t) => {
  const dir = await makeTempDir(t);
  const inputPath = path.join(dir, "codes.json");
  const outputDir = path.join(dir, "kline");
  await writeCodes(inputPath, ["600001"]);

  const existingPath = path.join(outputDir, "daily", "600", "600001.json");
  await fs.mkdir(path.dirname(existingPath), { recursive: true });
  await fs.writeFile(
    existingPath,
    `${JSON.stringify({ code: "600001", market: 1, period: "daily", klines: [] }, null, 2)}\n`,
    "utf8"
  );

  const options = parseArguments([
    inputPath,
    "--period",
    "daily",
    "--engine",
    "aws",
    "--output-dir",
    outputDir,
    "--min-success-rate",
    "0",
  ]);
  const { exitCode, summary } = await queryPoolKlines(options, async () => {
    throw new Error("should not fetch skipped files");
  });

  assert.equal(exitCode, 1);
  assert.equal(summary.failed, 0);
  assert.equal(summary.success, 0);
  assert.equal(summary.status, "failed_aws_unavailable");
  assert.deepEqual(summary.failure_reasons, ["aws_success_zero"]);
});
