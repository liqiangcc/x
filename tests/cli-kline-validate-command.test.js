"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildKlineValidateArgs,
  createKlineValidateCommand,
  runKlineValidateCommand,
} = require("../src/adapters/cli/commands/kline_validate");

function captureStream() {
  let value = "";
  return {
    stream: { write(chunk) { value += chunk; } },
    value: () => value,
  };
}

test("kline validate args preserve default target and optional period/json flags", () => {
  assert.deepEqual(buildKlineValidateArgs({ _: [] }), ["data/kline"]);
  assert.deepEqual(
    buildKlineValidateArgs({ _: ["data/custom"], period: "daily", json: true }),
    ["data/custom", "--period", "daily", "--json"],
  );
});

test("kline validate forwards successful child output without setting exit code", async () => {
  const stdout = captureStream();
  const stderr = captureStream();
  const exitCodes = [];
  const calls = [];

  const result = await runKlineValidateCommand({
    argv: ["data/custom", "--period", "yearly", "--json"],
    nodeScriptRunner: async (scriptPath, args) => {
      calls.push({ scriptPath, args });
      return { stdout: "{\"status\":\"ok\"}\n", stderr: "note\n" };
    },
    stdout: stdout.stream,
    stderr: stderr.stream,
    setExitCode: (code) => exitCodes.push(code),
  });

  assert.deepEqual(calls, [{
    scriptPath: "fetch/check_kline_empty.js",
    args: ["data/custom", "--period", "yearly", "--json"],
  }]);
  assert.equal(stdout.value(), "{\"status\":\"ok\"}\n");
  assert.equal(stderr.value(), "note\n");
  assert.deepEqual(exitCodes, []);
  assert.equal(result.result.exitCode, 0);
});

test("kline validate preserves non-zero child exit code and output", async () => {
  const stdout = captureStream();
  const stderr = captureStream();
  const exitCodes = [];
  const error = Object.assign(new Error("validation failed"), {
    code: 3,
    stdout: "partial\n",
    stderr: "invalid kline\n",
  });

  const result = await runKlineValidateCommand({
    argv: [],
    nodeScriptRunner: async () => {
      throw error;
    },
    stdout: stdout.stream,
    stderr: stderr.stream,
    setExitCode: (code) => exitCodes.push(code),
  });

  assert.equal(stdout.value(), "partial\n");
  assert.equal(stderr.value(), "invalid kline\n");
  assert.deepEqual(exitCodes, [3]);
  assert.equal(result.result.exitCode, 3);
});

test("kline validate validates CLI options before resolving process infrastructure", async () => {
  const command = createKlineValidateCommand({
    root: "/repo",
    createNodeScriptRunner: () => {
      throw new Error("runner should not be resolved");
    },
  });

  await assert.rejects(
    () => command(["--period"]),
    /Missing value for --period/,
  );
});

test("kline validate lazily composes the default runner with repository root", async () => {
  const roots = [];
  const calls = [];
  const command = createKlineValidateCommand({
    root: "/repo",
    createNodeScriptRunner: ({ root }) => {
      roots.push(root);
      return async (scriptPath, args) => {
        calls.push({ scriptPath, args });
        return { stdout: "", stderr: "" };
      };
    },
    stdout: { write() {} },
    stderr: { write() {} },
  });

  await command([]);
  assert.deepEqual(roots, ["/repo"]);
  assert.deepEqual(calls, [{
    scriptPath: "fetch/check_kline_empty.js",
    args: ["data/kline"],
  }]);
});
