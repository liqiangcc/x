"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  RetryKlineQueueUseCase,
  buildRetryQueueSyncRequest,
  normalizeExpectedLatestDate,
} = require("../src/application/kline/retry_kline_queue");

test("retry queue sync request preserves queue retry protocol", () => {
  assert.deepEqual(buildRetryQueueSyncRequest({
    concurrency: "2",
    due: {
      codes: ["000001", "600519"],
      expectedLatestDate: "2026-08-17",
      period: "daily",
    },
    dueFile: "/repo/data/queue/daily.due.json",
    policy: "proxy-only",
    queueFile: "/repo/data/queue/daily.json",
  }), {
    inputPath: "/repo/data/queue/daily.due.json",
    options: {
      concurrency: "2",
      failureQueue: "/repo/data/queue/daily.json",
      policy: "proxy-only",
      retryAttempts: "0",
      expectedLatestDate: "20260817",
      freshnessCodes: "/repo/data/queue/daily.due.json",
    },
    period: "daily",
  });
});

test("retry queue sync request omits freshness options without expected date", () => {
  assert.deepEqual(buildRetryQueueSyncRequest({
    concurrency: "7",
    due: { codes: ["600519"], expectedLatestDate: null, period: "yearly" },
    dueFile: "/repo/yearly.due.json",
    policy: "custom-policy",
    queueFile: "/repo/yearly.json",
  }), {
    inputPath: "/repo/yearly.due.json",
    options: {
      concurrency: "7",
      failureQueue: "/repo/yearly.json",
      policy: "custom-policy",
      retryAttempts: "0",
    },
    period: "yearly",
  });
});

test("retry queue request preserves legacy missing-period failure before sync", () => {
  assert.throws(() => buildRetryQueueSyncRequest({
    concurrency: "2",
    due: { codes: ["600519"], period: null },
    dueFile: "/repo/due.json",
    policy: "proxy-only",
    queueFile: "/repo/queue.json",
  }), /Missing value for --period/);
  assert.equal(normalizeExpectedLatestDate("2026-08-17"), "20260817");
  assert.equal(normalizeExpectedLatestDate(null), null);
});

test("retry queue use case stops when no items are due", async () => {
  const calls = [];
  const useCase = new RetryKlineQueueUseCase({
    writeDueCodes: async (queueFile, dueFile) => {
      calls.push(["write", queueFile, dueFile]);
      return { codes: [], expectedLatestDate: "2026-08-17", period: "daily" };
    },
    runKlineSync: async () => {
      calls.push(["sync"]);
      throw new Error("must not run");
    },
  });

  const result = await useCase.execute({
    concurrency: "2",
    dueFile: "/repo/queue.due.json",
    policy: "proxy-only",
    queueFile: "/repo/queue.json",
  });

  assert.deepEqual(calls, [["write", "/repo/queue.json", "/repo/queue.due.json"]]);
  assert.equal(result.status, "no_due_items");
  assert.equal(result.dueCount, 0);
  assert.equal(result.result, null);
  assert.equal(result.syncRequest, null);
});

test("retry queue use case executes structured kline sync for due items", async () => {
  const syncCalls = [];
  const useCase = new RetryKlineQueueUseCase({
    writeDueCodes: async () => ({
      codes: ["600519"],
      expectedLatestDate: "2026-08-17",
      period: "daily",
    }),
    runKlineSync: async (request) => {
      syncCalls.push(request);
      return { stdout: "sync-out\n", stderr: "sync-err\n" };
    },
  });

  const result = await useCase.execute({
    concurrency: "4",
    dueFile: "/repo/queue.due.json",
    policy: "proxy-only",
    queueFile: "/repo/queue.json",
  });

  assert.equal(result.status, "synced");
  assert.equal(result.dueCount, 1);
  assert.deepEqual(syncCalls, [result.syncRequest]);
  assert.deepEqual(result.result, { stdout: "sync-out\n", stderr: "sync-err\n" });
});
