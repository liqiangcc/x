"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildCodesBuildArgs,
  createCodesBuildCommand,
  runCodesBuildCommand,
} = require("../src/adapters/cli/commands/codes_build");

function captureStream() {
  let value = "";
  return {
    stream: { write(chunk) { value += String(chunk); } },
    value: () => value,
  };
}

test("buildCodesBuildArgs requires pool directory", () => {
  assert.throws(
    () => buildCodesBuildArgs({ _: [] }),
    /codes build requires <pool_dir>/,
  );
});

test("buildCodesBuildArgs preserves codes-only default", () => {
  assert.deepEqual(buildCodesBuildArgs({ _: ["data/pool/20260817"] }), [
    "data/pool/20260817",
    "--codes-only",
  ]);
});

test("buildCodesBuildArgs maps output option", () => {
  assert.deepEqual(buildCodesBuildArgs({
    _: ["data/pool/20260817"],
    output: "data/codes.json",
  }), [
    "data/pool/20260817",
    "--codes-only",
    "--output",
    "data/codes.json",
  ]);
});

test("runCodesBuildCommand rejects protocol errors before resolving runner", async () => {
  let runnerResolved = false;
  await assert.rejects(
    () => runCodesBuildCommand({
      argv: [],
      createNodeScriptRunner() {
        runnerResolved = true;
        return async () => ({});
      },
    }),
    /codes build requires <pool_dir>/,
  );
  assert.equal(runnerResolved, false);
});

test("runCodesBuildCommand launches parser script and forwards output", async () => {
  const stdout = captureStream();
  const stderr = captureStream();
  let invocation;
  const result = await runCodesBuildCommand({
    argv: ["data/pool/20260817", "--output", "tmp/codes.json"],
    nodeScriptRunner: async (scriptPath, args) => {
      invocation = { scriptPath, args };
      return { stdout: "ok\n", stderr: "warn\n" };
    },
    stdout: stdout.stream,
    stderr: stderr.stream,
  });

  assert.equal(invocation.scriptPath, "utils/parse_pool_json.js");
  assert.deepEqual(invocation.args, [
    "data/pool/20260817",
    "--codes-only",
    "--output",
    "tmp/codes.json",
  ]);
  assert.equal(stdout.value(), "ok\n");
  assert.equal(stderr.value(), "warn\n");
  assert.deepEqual(result.args, invocation.args);
});

test("createCodesBuildCommand passes root to injected runner factory", async () => {
  let receivedRoot;
  const command = createCodesBuildCommand({
    root: "/repo",
    createNodeScriptRunner({ root }) {
      receivedRoot = root;
      return async () => ({ stdout: "", stderr: "" });
    },
  });
  await command(["data/pool/20260817"]);
  assert.equal(receivedRoot, "/repo");
});
