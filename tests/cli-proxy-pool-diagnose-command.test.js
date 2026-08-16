"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createProxyPoolDiagnoseCommand,
  runProxyPoolDiagnoseCommand,
} = require("../src/adapters/cli/commands/proxy_pool_diagnose");

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

test("proxy diagnose CLI preserves defaults and JSON presentation", async () => {
  const stdout = outputSink();
  let request = null;
  const command = createProxyPoolDiagnoseCommand({
    stdout: stdout.stream,
    useCase: {
      async execute(value) {
        request = value;
        return { available_count: 0, passed: false, report: "runs/report.json" };
      },
    },
  });

  const report = await command([]);
  assert.deepEqual(request, { concurrency: 16, samples: 100, timeoutMs: 3000 });
  assert.equal(stdout.value(), `${JSON.stringify(report, null, 2)}\n`);
});

test("proxy diagnose CLI maps explicit numeric options", async () => {
  let request = null;
  await runProxyPoolDiagnoseCommand({
    argv: ["--concurrency", "7", "--samples", "25", "--timeout-ms", "4500"],
    useCase: {
      async execute(value) {
        request = value;
        return { available_count: 1, passed: true };
      },
    },
    stdout: { write() {} },
  });
  assert.deepEqual(request, { concurrency: 7, samples: 25, timeoutMs: 4500 });
});

test("proxy diagnose CLI validates protocol before resolving infrastructure", async () => {
  let resolutions = 0;
  await assert.rejects(
    () => runProxyPoolDiagnoseCommand({
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
    () => runProxyPoolDiagnoseCommand({
      argv: ["--timeout-ms"],
      getUseCase() {
        resolutions += 1;
        return { execute: async () => ({}) };
      },
    }),
    /Missing value for --timeout-ms/
  );
  assert.equal(resolutions, 0);
});

test("proxy diagnose CLI requires an executable use case", async () => {
  await assert.rejects(
    () => runProxyPoolDiagnoseCommand({ argv: [], useCase: {} }),
    /proxy pool diagnose useCase must expose execute\(\)/
  );
});
