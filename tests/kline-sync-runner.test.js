"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildKlineSyncRunArgs,
  createKlineSyncRunner,
} = require("../src/adapters/kline/kline_sync_runner");

test("kline sync runner builds script argv from a structured request", () => {
  assert.deepEqual(buildKlineSyncRunArgs({
    inputPath: "/repo/queue.due.json",
    options: {
      concurrency: "2",
      expectedLatestDate: "20260817",
      failureQueue: "/repo/queue.json",
      freshnessCodes: "/repo/queue.due.json",
      policy: "proxy-only",
      retryAttempts: "0",
    },
    period: "daily",
  }), [
    "/repo/queue.due.json",
    "--period", "daily",
    "--policy", "proxy-only",
    "--failure-queue", "/repo/queue.json",
    "--concurrency", "2",
    "--retry-attempts", "0",
    "--expected-latest-date", "20260817",
    "--freshness-codes", "/repo/queue.due.json",
  ]);
});

test("kline sync runner preserves optional engine and process output", async () => {
  const calls = [];
  const runKlineSync = createKlineSyncRunner({
    nodeScriptRunner: async (scriptPath, args) => {
      calls.push({ scriptPath, args });
      return { stdout: "out\n", stderr: "err\n" };
    },
  });

  const result = await runKlineSync({
    engine: "aws",
    inputPath: "codes.json",
    options: { concurrency: 3 },
    period: "yearly",
  });

  assert.deepEqual(calls, [{
    scriptPath: "fetch/query_pool_klines.js",
    args: [
      "codes.json",
      "--period", "yearly",
      "--engine", "aws",
      "--concurrency", "3",
    ],
  }]);
  assert.deepEqual(result, {
    args: [
      "codes.json",
      "--period", "yearly",
      "--engine", "aws",
      "--concurrency", "3",
    ],
    stderr: "err\n",
    stdout: "out\n",
  });
});

test("kline sync runner validates its narrow infrastructure contract", async () => {
  assert.throws(
    () => createKlineSyncRunner({}),
    /kline sync node script runner must be a function/,
  );
  assert.throws(
    () => buildKlineSyncRunArgs({ period: "daily" }),
    /inputPath is required/,
  );
  assert.throws(
    () => buildKlineSyncRunArgs({ inputPath: "codes.json" }),
    /Missing value for --period/,
  );
});
