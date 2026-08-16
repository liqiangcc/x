"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildKlineRetryRequest,
  createKlineRetryCommand,
  runKlineRetryCommand,
} = require("../src/adapters/cli/commands/kline_retry");

function sink() {
  let text = "";
  return { write(value) { text += String(value); }, get text() { return text; } };
}

test("kline retry validates input before resolving use case", async () => {
  let resolutions = 0;
  await assert.rejects(
    runKlineRetryCommand({
      argv: [],
      createUseCase() { resolutions += 1; return { execute: async () => ({}) }; },
    }),
    /kline retry requires <summary\.json\|failures\.json>/,
  );
  assert.equal(resolutions, 0);
});

test("kline retry parser preserves default engine and request shape", () => {
  const request = buildKlineRetryRequest({ _: ["summary.json"], engine: "aws" });
  assert.equal(request.inputPath, "summary.json");
  assert.equal(request.options.engine, "aws");
});

test("kline retry forwards output and maps child exit code", async () => {
  const stdout = sink();
  const stderr = sink();
  const exitCodes = [];
  const calls = [];
  const result = await runKlineRetryCommand({
    argv: ["failures.json", "--engine", "aws-router", "--retry-attempts", "5"],
    useCase: {
      async execute(request) {
        calls.push(request);
        return { result: { exitCode: 7, stdout: "out\n", stderr: "err\n" } };
      },
    },
    stdout,
    stderr,
    setExitCode: (code) => exitCodes.push(code),
  });
  assert.equal(calls[0].inputPath, "failures.json");
  assert.equal(calls[0].options.engine, "aws-router");
  assert.equal(calls[0].options.retryAttempts, "5");
  assert.equal(stdout.text, "out\n");
  assert.equal(stderr.text, "err\n");
  assert.deepEqual(exitCodes, [7]);
  assert.equal(result.result.exitCode, 7);
});

test("kline retry factory resolves application use case lazily", async () => {
  const resolutions = [];
  const command = createKlineRetryCommand({
    root: "/repo",
    cwd: "/work",
    createUseCase(context) {
      resolutions.push(context);
      return { execute: async () => ({ result: { exitCode: 0, stdout: "", stderr: "" } }) };
    },
  });
  await assert.rejects(command([]), /kline retry requires/);
  assert.equal(resolutions.length, 0);
  await command(["summary.json"]);
  assert.deepEqual(resolutions, [{ cwd: "/work", root: "/repo" }]);
});
