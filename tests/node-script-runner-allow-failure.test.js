"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  normalizeNodeScriptFailure,
  runNodeScriptAllowFailure,
} = require("../src/adapters/system/node_script_runner");

test("failure-aware node script execution preserves successful output", async () => {
  const calls = [];
  const result = await runNodeScriptAllowFailure(
    async (scriptPath, args) => {
      calls.push({ scriptPath, args });
      return { stdout: "ok\n", stderr: "warn\n" };
    },
    "fetch/task.js",
    ["--x", "1"],
  );

  assert.deepEqual(calls, [{ scriptPath: "fetch/task.js", args: ["--x", "1"] }]);
  assert.deepEqual(result, { exitCode: 0, stdout: "ok\n", stderr: "warn\n" });
});

test("failure-aware node script execution normalizes execFile failures", async () => {
  const error = Object.assign(new Error("failed"), {
    code: 7,
    stdout: "partial\n",
    stderr: "invalid\n",
  });

  assert.deepEqual(normalizeNodeScriptFailure(error), {
    exitCode: 7,
    stdout: "partial\n",
    stderr: "invalid\n",
  });

  const result = await runNodeScriptAllowFailure(
    async () => {
      throw error;
    },
    "fetch/task.js",
  );
  assert.deepEqual(result, {
    exitCode: 7,
    stdout: "partial\n",
    stderr: "invalid\n",
  });
});

test("failure-aware node script execution falls back to exit code 1 and error message", async () => {
  const result = await runNodeScriptAllowFailure(
    async () => {
      throw new Error("boom");
    },
    "fetch/task.js",
  );

  assert.deepEqual(result, {
    exitCode: 1,
    stdout: "",
    stderr: "boom",
  });
});
