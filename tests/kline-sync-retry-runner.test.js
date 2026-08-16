"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createKlineSyncRetryRunner,
  normalizeFailure,
} = require("../src/adapters/kline/kline_sync_retry_runner");

test("retry runner builds legacy sync script argv", async () => {
  const calls = [];
  const run = createKlineSyncRetryRunner({
    nodeScriptRunner: async (...args) => {
      calls.push(args);
      return { stdout: "ok\n", stderr: "warn\n" };
    },
  });
  const result = await run({
    inputPath: "/tmp/codes.json",
    period: "daily",
    engine: "aws",
    outputDir: "data/kline",
    options: {
      concurrency: 1,
      retryAttempts: 3,
      retryConcurrency: 1,
      awsRegion: "r1,r2",
      limit: null,
      outputDir: null,
    },
  });
  assert.deepEqual(calls, [["fetch/query_pool_klines.js", [
    "/tmp/codes.json", "--period", "daily", "--engine", "aws", "--output-dir", "data/kline",
    "--concurrency", "1", "--retry-attempts", "3", "--retry-concurrency", "1", "--aws-region", "r1,r2",
  ]]]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "ok\n");
  assert.equal(result.stderr, "warn\n");
});

test("retry runner converts child process failure into legacy result", async () => {
  const error = new Error("failed");
  error.code = 7;
  error.stdout = "partial\n";
  error.stderr = "bad\n";
  const run = createKlineSyncRetryRunner({ nodeScriptRunner: async () => { throw error; } });
  const result = await run({ inputPath: "codes.json", period: "yearly", engine: "aws", outputDir: "data/kline" });
  assert.equal(result.exitCode, 7);
  assert.equal(result.stdout, "partial\n");
  assert.equal(result.stderr, "bad\n");
  assert.deepEqual(normalizeFailure(error), { exitCode: 7, stdout: "partial\n", stderr: "bad\n" });
});
