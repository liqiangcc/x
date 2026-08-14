"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  CommitRunDataUseCase,
  GetDataStatusUseCase,
} = require("../src/application/git/data_commands");

function sampleContext() {
  return {
    quality: { status: "passed" },
    run: {
      date: "20260105",
      engine: "local",
      failed: 0,
      period: "daily",
      run_id: "run-1",
      skipped: 0,
      success: 1,
      total: 1,
      universe: "pool",
      yearly_aggregation_updated: 0,
    },
  };
}

test("GetDataStatusUseCase queries only existing data scopes", async () => {
  const calls = [];
  const useCase = new GetDataStatusUseCase({
    workspace: {
      async existingPathspecs(candidates) {
        calls.push(["existing", candidates]);
        return ["data", "runs"];
      },
      async status(input) {
        calls.push(["status", input]);
        return " M data/sample.json\n";
      },
    },
  });

  assert.equal(await useCase.execute(), " M data/sample.json\n");
  assert.deepEqual(calls, [
    ["existing", ["data", "runs", "reports"]],
    ["status", { pathspec: ["data", "runs"] }],
  ]);
});

test("CommitRunDataUseCase stages scoped data, builds commit message, and commits staged files", async () => {
  const calls = [];
  const context = sampleContext();
  const useCase = new CommitRunDataUseCase({
    runCommitContextReader: {
      async readCommitContext(input) {
        calls.push(["context", input]);
        return context;
      },
    },
    workspace: {
      async existingPathspecs(candidates) {
        calls.push(["existing", candidates]);
        return [...candidates];
      },
      async stage(input) {
        calls.push(["stage", input]);
      },
      async stagedFiles(input) {
        calls.push(["staged", input]);
        return ["data/kline/daily/000001.json", "runs/run-1/run.json"];
      },
      async commit(input) {
        calls.push(["commit", input]);
      },
    },
  });

  const result = await useCase.execute({ runId: "run-1" });
  assert.equal(result.status, "committed");
  assert.deepEqual(result.files, [
    "data/kline/daily/000001.json",
    "runs/run-1/run.json",
  ]);
  assert.equal(result.message.title, "data(daily): 20260105 update pool kline");
  assert.match(result.message.body, /^run_id: run-1/m);
  assert.match(result.message.body, /^quality: passed/m);
  assert.deepEqual(calls.slice(0, 4), [
    ["context", { runId: "run-1" }],
    ["existing", ["data/kline/daily", "runs/run-1"]],
    ["stage", { pathspec: ["data/kline/daily", "runs/run-1"] }],
    ["staged", { pathspec: ["data/kline/daily", "runs/run-1"] }],
  ]);
  assert.equal(calls[4][0], "commit");
  assert.deepEqual(calls[4][1].files, result.files);
  assert.equal(calls[4][1].title, result.message.title);
  assert.equal(calls[4][1].body, result.message.body);
});

test("CommitRunDataUseCase stops before staging when no data paths exist", async () => {
  let stageCalls = 0;
  const useCase = new CommitRunDataUseCase({
    runCommitContextReader: {
      async readCommitContext() {
        return sampleContext();
      },
    },
    workspace: {
      async existingPathspecs() { return []; },
      async stage() { stageCalls += 1; },
      async stagedFiles() { return []; },
      async commit() {},
    },
  });

  assert.deepEqual(
    await useCase.execute({ runId: "run-1" }),
    { status: "no-data-paths" }
  );
  assert.equal(stageCalls, 0);
});

test("CommitRunDataUseCase stops before commit when staging produces no files", async () => {
  let commitCalls = 0;
  const useCase = new CommitRunDataUseCase({
    runCommitContextReader: {
      async readCommitContext() {
        return sampleContext();
      },
    },
    workspace: {
      async existingPathspecs(candidates) { return candidates; },
      async stage() {},
      async stagedFiles() { return []; },
      async commit() { commitCalls += 1; },
    },
  });

  assert.deepEqual(
    await useCase.execute({ runId: "run-1" }),
    { status: "no-data-changes" }
  );
  assert.equal(commitCalls, 0);
});

test("CommitRunDataUseCase keeps runId opaque", async () => {
  let received = null;
  const useCase = new CommitRunDataUseCase({
    runCommitContextReader: {
      async readCommitContext(input) {
        received = input;
        return sampleContext();
      },
    },
    workspace: {
      async existingPathspecs() { return []; },
      async stage() {},
      async stagedFiles() { return []; },
      async commit() {},
    },
  });

  await useCase.execute({ runId: " run-1 " });
  assert.deepEqual(received, { runId: " run-1 " });
});
