"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createPoolPullCommand,
  normalizePoolPullDate,
  runPoolPullCommand,
} = require("../src/adapters/cli/commands/pool_pull");

function createBufferWriter() {
  let value = "";
  return {
    write(chunk) {
      value += String(chunk);
    },
    value() {
      return value;
    },
  };
}

test("pool pull CLI preserves default script arguments and process output", async () => {
  const calls = [];
  const stdout = createBufferWriter();
  const stderr = createBufferWriter();

  const result = await runPoolPullCommand({
    argv: [],
    nodeScriptRunner: async (scriptPath, args) => {
      calls.push({ scriptPath, args });
      return { stdout: "pool-output\n", stderr: "pool-warning\n" };
    },
    stdout,
    stderr,
  });

  assert.deepEqual(calls, [{
    scriptPath: "fetch/pull_pool_task.js",
    args: ["--engine", "curl", "--output-dir", "data/pool"],
  }]);
  assert.deepEqual(result.args, ["--engine", "curl", "--output-dir", "data/pool"]);
  assert.equal(stdout.value(), "pool-output\n");
  assert.equal(stderr.value(), "pool-warning\n");
});

test("pool pull CLI maps date, range, engine and output options exactly", async () => {
  const calls = [];
  await runPoolPullCommand({
    argv: [
      "--date", "2026-08-17",
      "--range-days", "5",
      "--engine", "node",
      "--output-dir", "tmp/pool",
    ],
    nodeScriptRunner: async (scriptPath, args) => {
      calls.push({ scriptPath, args });
      return { stdout: "", stderr: "" };
    },
  });

  assert.deepEqual(calls[0], {
    scriptPath: "fetch/pull_pool_task.js",
    args: [
      "20260817",
      "--range-days", "5",
      "--engine", "node",
      "--output-dir", "tmp/pool",
    ],
  });
});

test("pool pull CLI preserves legacy date precedence over positional date and latest", async () => {
  const calls = [];
  await runPoolPullCommand({
    argv: ["20260816", "--latest", "--date", "20260817"],
    nodeScriptRunner: async (_scriptPath, args) => {
      calls.push(args);
      return { stdout: "", stderr: "" };
    },
  });

  assert.equal(calls[0][0], "20260817");
  assert.equal(calls[0].includes("--days"), false);
});

test("pool pull CLI uses positional date before latest when --date is absent", async () => {
  const calls = [];
  await runPoolPullCommand({
    argv: ["2026-08-16", "--latest"],
    nodeScriptRunner: async (_scriptPath, args) => {
      calls.push(args);
      return { stdout: "", stderr: "" };
    },
  });

  assert.equal(calls[0][0], "20260816");
  assert.equal(calls[0].includes("--days"), false);
});

test("pool pull CLI maps latest to legacy --days 0", async () => {
  const calls = [];
  await runPoolPullCommand({
    argv: ["--latest"],
    nodeScriptRunner: async (_scriptPath, args) => {
      calls.push(args);
      return { stdout: "", stderr: "" };
    },
  });

  assert.deepEqual(calls[0].slice(0, 2), ["--days", "0"]);
});

test("pool pull CLI preserves loose 8-digit date validation", () => {
  assert.equal(normalizePoolPullDate("2026-02-31"), "20260231");
  assert.throws(() => normalizePoolPullDate("2026-2-1"), /Invalid date: 2026-2-1/);
});

test("pool pull CLI validates protocol before resolving process infrastructure", async () => {
  let factoryCalls = 0;
  const command = createPoolPullCommand({
    root: "/repo",
    createNodeScriptRunner: () => {
      factoryCalls += 1;
      return async () => ({ stdout: "", stderr: "" });
    },
  });

  await assert.rejects(
    () => command(["--date", "bad"]),
    /Invalid date: bad/,
  );
  assert.equal(factoryCalls, 0);

  await assert.rejects(
    () => command(["--range-days"]),
    /Missing value for --range-days/,
  );
  assert.equal(factoryCalls, 0);
});

test("pool pull command factory injects root into the node script runner factory", async () => {
  const factoryCalls = [];
  const runnerCalls = [];
  const command = createPoolPullCommand({
    root: "/repo",
    createNodeScriptRunner: (options) => {
      factoryCalls.push(options);
      return async (scriptPath, args) => {
        runnerCalls.push({ scriptPath, args });
        return { stdout: "", stderr: "" };
      };
    },
  });

  await command(["--latest"]);
  assert.deepEqual(factoryCalls, [{ root: "/repo" }]);
  assert.equal(runnerCalls.length, 1);
});

test("pool pull command requires a node script runner after protocol validation", async () => {
  await assert.rejects(
    () => runPoolPullCommand({ argv: [] }),
    /pool pull node script runner must be a function/,
  );
});
