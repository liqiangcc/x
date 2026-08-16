"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  DEFAULT_MAX_BUFFER,
  createNodeScriptRunner,
} = require("../src/adapters/system/node_script_runner");

test("node script runner executes a root-relative script with stable process defaults", async () => {
  const calls = [];
  const env = { TEST_ENV: "1" };
  const root = path.join(path.sep, "repo");
  const runner = createNodeScriptRunner({
    root,
    env,
    executeFile: async (...args) => {
      calls.push(args);
      return { stdout: "ok\n", stderr: "warn\n" };
    },
  });

  const result = await runner("fetch/task.js", ["--x", "1"]);

  assert.deepEqual(result, { stdout: "ok\n", stderr: "warn\n" });
  assert.deepEqual(calls, [[
    "node",
    [path.join(root, "fetch/task.js"), "--x", "1"],
    {
      cwd: root,
      env,
      maxBuffer: DEFAULT_MAX_BUFFER,
    },
  ]]);
});

test("node script runner supports injected executable and max buffer", async () => {
  const calls = [];
  const runner = createNodeScriptRunner({
    root: "/repo",
    nodeExecutable: "/node/bin/node",
    maxBuffer: 1234,
    executeFile: async (...args) => {
      calls.push(args);
      return { stdout: "", stderr: "" };
    },
  });

  await runner("script.js");
  assert.equal(calls[0][0], "/node/bin/node");
  assert.equal(calls[0][2].maxBuffer, 1234);
});

test("node script runner validates its narrow contract", async () => {
  assert.throws(
    () => createNodeScriptRunner(),
    /node script runner root is required/,
  );
  assert.throws(
    () => createNodeScriptRunner({ root: "/repo", executeFile: null }),
    /executeFile must be a function/,
  );

  const runner = createNodeScriptRunner({
    root: "/repo",
    executeFile: async () => ({ stdout: "", stderr: "" }),
  });
  await assert.rejects(() => runner(), /node script path is required/);
  await assert.rejects(() => runner("task.js", "bad"), /args must be an array/);
});
