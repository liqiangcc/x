"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createProxyPoolBenchmarkCommand,
  runProxyPoolBenchmarkCommand,
} = require("../src/adapters/cli/commands/proxy_pool_benchmark");

function outputSink() {
  let value = "";
  return {
    stream: {
      write(chunk) {
        value += String(chunk);
      },
    },
    value: () => value,
  };
}

test("proxy benchmark CLI preserves defaults and JSON presentation", async () => {
  const stdout = outputSink();
  let request = null;
  const exitCodes = [];
  const command = createProxyPoolBenchmarkCommand({
    stdout: stdout.stream,
    setExitCode(code) {
      exitCodes.push(code);
    },
    useCase: {
      async execute(value) {
        request = value;
        return { samples: 100, concurrency: 4, passed: true, report: "runs/report.json" };
      },
    },
  });

  const report = await command([]);

  assert.deepEqual(request, { samples: 100, concurrency: 4 });
  assert.equal(stdout.value(), `${JSON.stringify(report, null, 2)}\n`);
  assert.deepEqual(exitCodes, []);
});

test("proxy benchmark CLI maps explicit numeric options", async () => {
  let request = null;
  await runProxyPoolBenchmarkCommand({
    argv: ["--samples", "25", "--concurrency", "7", "--json"],
    useCase: {
      async execute(value) {
        request = value;
        return { passed: true };
      },
    },
    stdout: { write() {} },
  });

  assert.deepEqual(request, { samples: 25, concurrency: 7 });
});

test("proxy benchmark CLI preserves exit code 2 for failed benchmark reports", async () => {
  const exitCodes = [];
  const report = await runProxyPoolBenchmarkCommand({
    argv: [],
    useCase: {
      async execute() {
        return { passed: false };
      },
    },
    stdout: { write() {} },
    setExitCode(code) {
      exitCodes.push(code);
    },
  });

  assert.equal(report.passed, false);
  assert.deepEqual(exitCodes, [2]);
});

test("proxy benchmark CLI validates protocol before resolving infrastructure", async () => {
  let resolutions = 0;
  await assert.rejects(
    () => runProxyPoolBenchmarkCommand({
      argv: ["--samples", "0"],
      getUseCase() {
        resolutions += 1;
        return { execute: async () => ({}) };
      },
    }),
    /--samples must be a positive integer/
  );
  assert.equal(resolutions, 0);

  await assert.rejects(
    () => runProxyPoolBenchmarkCommand({
      argv: ["--concurrency", "0"],
      getUseCase() {
        resolutions += 1;
        return { execute: async () => ({}) };
      },
    }),
    /--concurrency must be a positive integer/
  );
  assert.equal(resolutions, 0);

  await assert.rejects(
    () => runProxyPoolBenchmarkCommand({
      argv: ["--samples"],
      getUseCase() {
        resolutions += 1;
        return { execute: async () => ({}) };
      },
    }),
    /Missing value for --samples/
  );
  assert.equal(resolutions, 0);
});

test("proxy benchmark CLI requires an executable use case", async () => {
  await assert.rejects(
    () => runProxyPoolBenchmarkCommand({ argv: [], useCase: {} }),
    /proxy pool benchmark useCase must expose execute\(\)/
  );
});
