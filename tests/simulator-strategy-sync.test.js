"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { PassThrough } = require("node:stream");
const test = require("node:test");
const { CliStrategySyncRunner } = require("../src/simulator/adapters/process/cli_strategy_sync_runner");
const { StrategySyncOrchestrator } = require("../src/simulator/application/strategy_sync_orchestrator");

async function until(predicate) {
  for (let index = 0; index < 50; index += 1) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for strategy sync state.");
}

test("strategy sync orchestrates data update before index rebuild", async () => {
  const calls = [];
  const runnerResult = { exitCode: 0, output: [], updatedCodes: ["600519"] };
  const runner = { run: async ({ downTransitions, onStage, strategyId }) => {
    calls.push({ downTransitions, strategyId });
    onStage("[stage] syncing");
    return runnerResult;
  } };
  const orchestrator = new StrategySyncOrchestrator({ runner });
  let rebuildInput = null;
  const started = orchestrator.start({ strategyId: "strategy-a", downTransitions: 4, afterSync: async (result) => { rebuildInput = result; } });
  assert.equal(started.status, "queued");

  const completed = await until(() => orchestrator.latest("strategy-a")?.status === "completed" && orchestrator.latest("strategy-a"));
  assert.deepEqual(calls, [{ downTransitions: 4, strategyId: "strategy-a" }]);
  assert.equal(rebuildInput, runnerResult);
  assert.equal(completed.phase, "completed");
  assert.deepEqual(completed.stages, ["[stage] syncing"]);
});

test("strategy sync prevents overlapping jobs and records runner failures", async () => {
  let release;
  const runner = { run: () => new Promise((resolve) => { release = resolve; }) };
  const orchestrator = new StrategySyncOrchestrator({ runner });
  orchestrator.start({ strategyId: "strategy-a" });
  assert.throws(() => orchestrator.start({ strategyId: "strategy-b" }), (error) => error.code === "strategy_sync_running" && error.statusCode === 409);
  await until(() => release);
  release({ exitCode: 2, output: ["network failed"] });
  const failed = await until(() => orchestrator.latest("strategy-a")?.status === "failed" && orchestrator.latest("strategy-a"));
  assert.equal(failed.error, "network failed");
});

test("CLI strategy runner passes only validated orchestration arguments", async () => {
  let invocation;
  const spawnImpl = (command, args, options) => {
    invocation = { args, command, options };
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    process.nextTick(() => {
      child.stderr.end("[stage] 2026-07-13T00:00:00Z start daily {}\n");
      child.stdout.end("runs/example/run.json\n");
      child.emit("close", 0);
    });
    return child;
  };
  const stages = [];
  const runner = new CliStrategySyncRunner({ cnFastThreshold: 400, concurrency: 2, engine: "local", root: "/workspace", spawnImpl });
  const result = await runner.run({ strategyId: "strategy-a", downTransitions: 4, marketBoards: ["mainBoard", "chiNext"], onStage: (line) => stages.push(line) });

  assert.equal(invocation.command, process.execPath);
  assert.deepEqual(invocation.args, [
    "/workspace/bin/x", "daily", "--latest", "--period", "daily", "--strategy-id", "strategy-a",
    "--strategy-down-transitions", "4", "--strategy-boards", "mainBoard,chiNext", "--engine", "local", "--cn-fast-threshold", "400",
    "--job-mode", "single", "--concurrency", "2",
  ]);
  assert.equal(invocation.options.env.X_STAGE_LOG, "1");
  assert.equal(result.exitCode, 0);
  assert.equal(stages.length, 1);
});

test("CLI strategy runner returns the run's updated code artifact", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "x-strategy-sync-runner-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const runId = "20260713T000000Z_daily";
  await fs.mkdir(path.join(root, "runs", runId), { recursive: true });
  await fs.writeFile(path.join(root, "runs", runId, "updated-codes.json"), JSON.stringify({ codes: ["000001", "600519"] }));
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    process.nextTick(() => {
      child.stderr.end(`[stage] 2026-07-13T00:00:00Z end daily_end {"run_id":"${runId}"}\n`);
      child.stdout.end();
      child.emit("close", 0);
    });
    return child;
  };
  const result = await new CliStrategySyncRunner({ root, spawnImpl }).run({ strategyId: "strategy-a" });
  assert.equal(result.runId, runId);
  assert.deepEqual(result.updatedCodes, ["000001", "600519"]);
});
