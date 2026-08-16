"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  RetryKlinesUseCase,
  buildKlineRetryPlan,
  extractRetryCodes,
  inferKlineOutputDirFromSummary,
  inferKlineRetryPeriod,
} = require("../src/application/kline/retry_klines");

test("extractRetryCodes preserves legacy artifact shapes", () => {
  assert.deepEqual(extractRetryCodes({ codes: ["2", 1, "2", ""] }), ["1", "2"]);
  assert.deepEqual(extractRetryCodes({ files: {
    "000002": { status: "failed" },
    "000001": { code: "600001", status: "failed" },
    "000003": { status: "success" },
  } }), ["000002", "600001"]);
  assert.deepEqual(extractRetryCodes({ items: [
    { target: "1.600519", period: "daily" },
    { code: "000001" },
    { target: "1.600519" },
  ] }), ["000001", "600519"]);
  assert.deepEqual(extractRetryCodes({}), []);
});

test("retry plan preserves legacy period, output, and retry defaults", () => {
  const inputPath = "/tmp/data/kline/daily/summary.daily.json";
  const plan = buildKlineRetryPlan({
    inputPath,
    payload: { period: "daily", codes: ["600519"] },
    options: { engine: "aws-router" },
  });
  assert.equal(plan.period, "daily");
  assert.equal(plan.outputDir, "/tmp/data/kline");
  assert.equal(plan.engine, "aws-router");
  assert.equal(plan.syncOptions.concurrency, 1);
  assert.equal(plan.syncOptions.retryAttempts, 3);
  assert.equal(plan.syncOptions.retryConcurrency, 1);
  assert.equal(plan.syncOptions.limit, null);
  assert.equal(plan.syncOptions.outputDir, null);
});

test("requested period wins over payload and item period", () => {
  const payload = { period: "daily", items: [{ code: "1", period: "yearly" }] };
  assert.equal(inferKlineRetryPeriod(payload, "weekly"), "weekly");
  assert.equal(inferKlineRetryPeriod(payload), "daily");
  assert.equal(inferKlineRetryPeriod({ items: payload.items }), "yearly");
  assert.equal(inferKlineRetryPeriod({}), "daily");
  assert.equal(inferKlineOutputDirFromSummary("failures.json", "daily"), "data/kline");
});

test("RetryKlinesUseCase orchestrates artifact, temporary input, sync, and cleanup", async () => {
  const calls = [];
  const useCase = new RetryKlinesUseCase({
    async readRetryArtifact(inputPath) {
      calls.push(["read", inputPath]);
      return { codes: ["600519"] };
    },
    async createRetryCodesInput(codes) {
      calls.push(["create", codes]);
      return {
        path: "/tmp/retry/codes.json",
        async cleanup() { calls.push(["cleanup"]); },
      };
    },
    async runKlineSync(request) {
      calls.push(["run", request]);
      return { exitCode: 0, stdout: "ok\n", stderr: "" };
    },
  });

  const result = await useCase.execute({ inputPath: "summary.json", options: { engine: "aws" } });
  assert.equal(result.result.stdout, "ok\n");
  assert.deepEqual(calls.map((item) => item[0]), ["read", "create", "run", "cleanup"]);
  assert.equal(calls[2][1].inputPath, "/tmp/retry/codes.json");
  assert.equal(calls[2][1].period, "daily");
});

test("RetryKlinesUseCase always cleans temporary input when sync throws", async () => {
  let cleaned = false;
  const useCase = new RetryKlinesUseCase({
    readRetryArtifact: async () => ({ codes: ["1"] }),
    createRetryCodesInput: async () => ({ path: "/tmp/codes.json", cleanup: async () => { cleaned = true; } }),
    runKlineSync: async () => { throw new Error("boom"); },
  });
  await assert.rejects(useCase.execute({ inputPath: "failures.json" }), /boom/);
  assert.equal(cleaned, true);
});
