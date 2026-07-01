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

function klinePayload(code, engine = "aws", region = "ap-northeast-1", metrics = {}) {
  return {
    source_engine: engine,
    source_region: region,
    ...metrics,
    data: {
      code,
      market: code.startsWith("6") ? 1 : 0,
      klines: ["2026-06-30,1,2,3,1,100,200,0,0,0,0"],
    },
  };
}

function normalizedKlinePayload(code) {
  return {
    code,
    market: code.startsWith("6") ? 1 : 0,
    period: "daily",
    klines: ["2026-06-30,1,2,3,1,100,200,0,0,0,0"],
  };
}

test("queryPoolKlines parses Huawei Cloud engine options", () => {
  const options = parseArguments([
    "codes.json",
    "--engine",
    "huaweicloud",
    "--huaweicloud-region",
    "cn-east-3,cn-north-4",
    "--huaweicloud-region-start-index",
    "2",
    "--huaweicloud-targets",
    "/tmp/huaweicloud-targets.json",
  ]);

  assert.equal(options.engine, "huaweicloud");
  assert.equal(options.huaweiCloudRegions, "cn-east-3,cn-north-4");
  assert.equal(options.huaweiCloudRegionStartIndex, 2);
  assert.equal(options.huaweiCloudTargetsFile, "/tmp/huaweicloud-targets.json");
});

test("queryPoolKlines handles concurrent success, failure, and skipped files", async (t) => {
  const dir = await makeTempDir(t);
  const inputPath = path.join(dir, "codes.json");
  const outputDir = path.join(dir, "kline");
  await writeCodes(inputPath, ["600001", "600002", "600003", "600004"]);

  const existingPath = path.join(outputDir, "daily", "600", "600004.json");
  await fs.mkdir(path.dirname(existingPath), { recursive: true });
  await fs.writeFile(
    existingPath,
    `${JSON.stringify(normalizedKlinePayload("600004"), null, 2)}\n`,
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
  assert.equal(summary.success_rate, 0.75);
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

test("queryPoolKlines defers empty fetched klines without writing files", async (t) => {
  const dir = await makeTempDir(t);
  const inputPath = path.join(dir, "codes.json");
  const outputDir = path.join(dir, "kline");
  await writeCodes(inputPath, ["600001"]);

  const options = parseArguments([
    inputPath,
    "--period",
    "daily",
    "--engine",
    "aws",
    "--output-dir",
    outputDir,
  ]);
  const { exitCode, summary } = await queryPoolKlines(options, async () => ({
    source_engine: "aws",
    source_region: "ap-northeast-1",
    data: {
      code: "600001",
      market: 1,
      klines: [],
    },
  }));

  const outputPath = path.join(outputDir, "daily", "600", "600001.json");
  await assert.rejects(fs.access(outputPath));
  assert.equal(exitCode, 1);
  assert.equal(summary.success, 0);
  assert.equal(summary.failed, 1);
  assert.equal(summary.files["600001"].status, "failed");
  assert.equal(summary.files["600001"].error_class, "empty_klines");
  assert.equal(summary.files["600001"].retriable, false);
  assert.equal(summary.files["600001"].deferred, true);
  assert.equal(summary.initial_failed, 1);
  assert.equal(summary.retried, 0);
});

test("queryPoolKlines refetches existing empty output instead of skipping it", async (t) => {
  const dir = await makeTempDir(t);
  const inputPath = path.join(dir, "codes.json");
  const outputDir = path.join(dir, "kline");
  await writeCodes(inputPath, ["600001"]);

  const outputPath = path.join(outputDir, "daily", "600", "600001.json");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(
    outputPath,
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
  ]);
  let calls = 0;
  const { exitCode, summary } = await queryPoolKlines(options, async () => {
    calls += 1;
    return klinePayload("600001", "aws", "ap-northeast-1");
  });

  const rewritten = JSON.parse(await fs.readFile(outputPath, "utf8"));
  assert.equal(exitCode, 0);
  assert.equal(calls, 1);
  assert.equal(summary.success, 1);
  assert.equal(summary.skipped_existing, 0);
  assert.equal(summary.files["600001"].status, "success");
  assert.equal(rewritten.klines.length, 1);
});

test("queryPoolKlines retries transient failures serially", async (t) => {
  const dir = await makeTempDir(t);
  const inputPath = path.join(dir, "codes.json");
  const outputDir = path.join(dir, "kline");
  await writeCodes(inputPath, ["600001", "600002"]);

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
    "--retry-attempts",
    "1",
    "--retry-delay-ms",
    "0",
    "--retry-concurrency",
    "1",
  ]);
  const attempts = {};
  const regionStartIndexes = [];
  const { exitCode, summary } = await queryPoolKlines(options, async (secid, fetchOptions) => {
    attempts[secid] = (attempts[secid] ?? 0) + 1;
    regionStartIndexes.push(fetchOptions.awsRegionStartIndex);
    if (secid === "1.600001" && attempts[secid] === 1) {
      throw new Error("UND_ERR_SOCKET fetch failed");
    }
    return klinePayload(secid.split(".")[1], "aws", "ap-northeast-1");
  });

  assert.equal(exitCode, 0);
  assert.equal(attempts["1.600001"], 2);
  assert.equal(attempts["1.600002"], 1);
  assert.deepEqual(regionStartIndexes.sort((left, right) => left - right), [0, 1, 2]);
  assert.equal(summary.initial_failed, 1);
  assert.equal(summary.retried, 1);
  assert.equal(summary.retry_success, 1);
  assert.equal(summary.retry_failed, 0);
  assert.deepEqual(summary.retriable_failure_counts, { transient_network: 1 });
  assert.equal(summary.attempts_by_code["600001"], 2);
  assert.equal(summary.files["600001"].status, "success");
  assert.deepEqual(summary.failure_reasons, []);
});

test("queryPoolKlines batch-size selects the next missing codes", async (t) => {
  const dir = await makeTempDir(t);
  const inputPath = path.join(dir, "codes.json");
  const outputDir = path.join(dir, "kline");
  await writeCodes(inputPath, ["600001", "600002", "600003"]);

  const existingPath = path.join(outputDir, "daily", "600", "600001.json");
  await fs.mkdir(path.dirname(existingPath), { recursive: true });
  await fs.writeFile(
    existingPath,
    `${JSON.stringify(normalizedKlinePayload("600001"), null, 2)}\n`,
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
    "--batch-size",
    "1",
  ]);
  const requested = [];
  const { exitCode, summary } = await queryPoolKlines(options, async (secid) => {
    requested.push(secid);
    return klinePayload(secid.split(".")[1], "aws", "ap-northeast-1");
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(requested, ["1.600002"]);
  assert.equal(summary.available_codes, 3);
  assert.equal(summary.candidate_codes, 2);
  assert.equal(summary.total_codes, 1);
  assert.equal(summary.selection_mode, "next_missing");
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

test("queryPoolKlines fails AWS min-rate runs with zero AWS fetch successes", async (t) => {
  const dir = await makeTempDir(t);
  const inputPath = path.join(dir, "codes.json");
  const outputDir = path.join(dir, "kline");
  await writeCodes(inputPath, ["600001"]);

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
    throw new Error("UND_ERR_SOCKET fetch failed");
  });

  assert.equal(exitCode, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.success, 0);
  assert.equal(summary.status, "failed_aws_unavailable");
  assert.deepEqual(summary.failure_reasons, ["failed_items", "aws_success_zero"]);
  assert.deepEqual(summary.failure_reason_counts, { transient_network: 1 });
});

test("queryPoolKlines records aws-router regions and duration metrics", async (t) => {
  const dir = await makeTempDir(t);
  const inputPath = path.join(dir, "codes.json");
  const outputDir = path.join(dir, "kline");
  await writeCodes(inputPath, ["600001", "600002"]);

  const options = parseArguments([
    inputPath,
    "--period",
    "daily",
    "--engine",
    "aws-router",
    "--output-dir",
    outputDir,
    "--force",
  ]);
  const { exitCode, summary } = await queryPoolKlines(options, async (secid) =>
    klinePayload(secid.split(".")[1], "aws-router", "us-east-1", {
      router_duration_ms: 5,
      target_duration_ms: 20,
      eastmoney_duration_ms: 15,
      total_duration_ms: secid === "1.600001" ? 40 : 60,
      fallback_count: 1,
      attempted_regions: ["ap-northeast-2", "us-east-1"],
    })
  );

  assert.equal(exitCode, 0);
  assert.equal(summary.aws_region_strategy, "router_auto");
  assert.deepEqual(summary.engine_counts, { "aws-router": 2 });
  assert.deepEqual(summary.region_counts, { "us-east-1": 2 });
  assert.deepEqual(summary.duration_ms_by_code, {
    "600001": 40,
    "600002": 60,
  });
  assert.equal(summary.avg_duration_ms, 50);
  assert.equal(summary.p50_duration_ms, 40);
  assert.equal(summary.p95_duration_ms, 60);
  assert.equal(summary.files["600001"].fallback_count, 1);
  assert.deepEqual(summary.files["600001"].attempted_regions, ["ap-northeast-2", "us-east-1"]);
});

test("queryPoolKlines records Huawei Cloud regions and duration metrics", async (t) => {
  const dir = await makeTempDir(t);
  const inputPath = path.join(dir, "codes.json");
  const outputDir = path.join(dir, "kline");
  await writeCodes(inputPath, ["600001", "600002"]);

  const options = parseArguments([
    inputPath,
    "--period",
    "daily",
    "--engine",
    "huaweicloud",
    "--huaweicloud-region",
    "cn-east-3,cn-north-4",
    "--output-dir",
    outputDir,
    "--force",
  ]);
  const startIndexes = [];
  const { exitCode, summary } = await queryPoolKlines(options, async (secid, fetchOptions) => {
    startIndexes.push(fetchOptions.huaweiCloudRegionStartIndex);
    const region = fetchOptions.huaweiCloudRegionStartIndex % 2 === 0 ? "cn-east-3" : "cn-north-4";
    return klinePayload(secid.split(".")[1], "huaweicloud", region, {
      target_duration_ms: 20,
      eastmoney_duration_ms: 15,
      total_duration_ms: secid === "1.600001" ? 35 : 55,
    });
  });

  assert.equal(exitCode, 0);
  assert.equal(summary.aws_region_strategy, "none");
  assert.equal(summary.huaweicloud_region_strategy, "round_robin_start_index");
  assert.deepEqual(startIndexes, [0, 1]);
  assert.deepEqual(summary.engine_counts, { huaweicloud: 2 });
  assert.deepEqual(summary.region_counts, { "cn-east-3": 1, "cn-north-4": 1 });
  assert.deepEqual(summary.duration_ms_by_code, {
    "600001": 35,
    "600002": 55,
  });
});
