"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildKlineRetryQueueRequest,
  createKlineRetryQueueCommand,
  runKlineRetryQueueCommand,
} = require("../src/adapters/cli/commands/kline_retry_queue");

function captureStream() {
  let value = "";
  return {
    stream: { write(chunk) { value += String(chunk); } },
    value: () => value,
  };
}

test("retry queue request resolves queue and due paths under repo root", () => {
  assert.deepEqual(buildKlineRetryQueueRequest({
    _: ["data/failure-queue/daily.json"],
    concurrency: "2",
    policy: "proxy-only",
  }, { root: "/repo" }), {
    concurrency: "2",
    dueFile: "/repo/data/failure-queue/daily.due.json",
    policy: "proxy-only",
    queueFile: "/repo/data/failure-queue/daily.json",
  });

  assert.throws(
    () => buildKlineRetryQueueRequest({ _: [] }, { root: "/repo" }),
    /kline retry-queue requires <queue.json>\./,
  );
});

test("retry queue command prints legacy no-due JSON and does not invent sync output", async () => {
  const stdout = captureStream();
  const stderr = captureStream();
  const calls = [];
  const command = createKlineRetryQueueCommand({
    root: "/repo",
    stdout: stdout.stream,
    stderr: stderr.stream,
    useCase: {
      async execute(request) {
        calls.push(request);
        return {
          dueCount: 0,
          queueFile: request.queueFile,
          result: null,
          status: "no_due_items",
        };
      },
    },
  });

  const result = await command(["data/queue/daily.json"]);

  assert.deepEqual(calls, [{
    concurrency: "2",
    dueFile: "/repo/data/queue/daily.due.json",
    policy: "proxy-only",
    queueFile: "/repo/data/queue/daily.json",
  }]);
  assert.equal(result.status, "no_due_items");
  assert.equal(stdout.value(), `${JSON.stringify({
    status: "no_due_items",
    queue: "/repo/data/queue/daily.json",
    due: 0,
  }, null, 2)}\n`);
  assert.equal(stderr.value(), "");
});

test("retry queue command forwards sync stdout and stderr unchanged", async () => {
  const stdout = captureStream();
  const stderr = captureStream();

  const result = await runKlineRetryQueueCommand({
    argv: ["queue.json", "--policy", "p", "--concurrency", "5"],
    root: "/repo",
    stdout: stdout.stream,
    stderr: stderr.stream,
    useCase: {
      async execute(request) {
        assert.deepEqual(request, {
          concurrency: "5",
          dueFile: "/repo/queue.due.json",
          policy: "p",
          queueFile: "/repo/queue.json",
        });
        return {
          result: { stdout: "sync-out\n", stderr: "sync-err\n" },
          status: "synced",
        };
      },
    },
  });

  assert.equal(result.status, "synced");
  assert.equal(stdout.value(), "sync-out\n");
  assert.equal(stderr.value(), "sync-err\n");
});

test("retry queue protocol validation happens before lazy use case resolution", async () => {
  let factoryCalls = 0;
  const createUseCase = () => {
    factoryCalls += 1;
    return { execute: async () => ({ status: "no_due_items" }) };
  };

  await assert.rejects(
    () => runKlineRetryQueueCommand({ argv: [], root: "/repo", createUseCase }),
    /kline retry-queue requires <queue.json>\./,
  );
  await assert.rejects(
    () => runKlineRetryQueueCommand({ argv: ["queue.json", "--policy"], root: "/repo", createUseCase }),
    /Missing value for --policy/,
  );
  await assert.rejects(
    () => runKlineRetryQueueCommand({ argv: ["queue.json", "--concurrency"], root: "/repo", createUseCase }),
    /Missing value for --concurrency/,
  );
  assert.equal(factoryCalls, 0);
});
