"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createProxyPoolProbeCommand,
  parseDurationMs,
  runProxyPoolProbeCommand,
} = require("../src/adapters/cli/commands/proxy_pool_probe");

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

test("proxy probe CLI preserves defaults and JSON presentation", async () => {
  const stdout = outputSink();
  let request = null;
  const command = createProxyPoolProbeCommand({
    stdout: stdout.stream,
    sessionFactory: { open() {} },
    reportWriter: { write() {} },
  });

  const report = await runProxyPoolProbeCommand({
    argv: [],
    useCase: {
      async execute(value) {
        request = value;
        return { rounds: [], target: "eastmoney-kline", report: "runs/report.json" };
      },
    },
    stdout: stdout.stream,
  });

  assert.equal(typeof command, "function");
  assert.deepEqual(request, {
    durationMs: 600_000,
    intervalMs: 30_000,
    samples: 20,
    concurrency: 2,
    timeoutMs: 5000,
  });
  assert.equal(stdout.value(), `${JSON.stringify(report, null, 2)}\n`);
});

test("proxy probe CLI maps explicit duration and numeric options", async () => {
  let request = null;
  await runProxyPoolProbeCommand({
    argv: [
      "--duration", "2m",
      "--interval", "15s",
      "--samples", "25",
      "--concurrency", "4",
      "--hard-deadline-ms", "4500",
    ],
    useCase: {
      async execute(value) {
        request = value;
        return { rounds: [] };
      },
    },
    stdout: { write() {} },
  });

  assert.deepEqual(request, {
    durationMs: 120_000,
    intervalMs: 15_000,
    samples: 25,
    concurrency: 4,
    timeoutMs: 4500,
  });
});

test("proxy probe CLI validates protocol before resolving infrastructure", async () => {
  let resolutions = 0;
  await assert.rejects(
    () => runProxyPoolProbeCommand({
      argv: ["--duration", "0m"],
      getUseCase() {
        resolutions += 1;
        return { execute: async () => ({}) };
      },
    }),
    /Invalid duration: 0m/
  );
  assert.equal(resolutions, 0);

  await assert.rejects(
    () => runProxyPoolProbeCommand({
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
    () => runProxyPoolProbeCommand({
      argv: ["--hard-deadline-ms"],
      getUseCase() {
        resolutions += 1;
        return { execute: async () => ({}) };
      },
    }),
    /Missing value for --hard-deadline-ms/
  );
  assert.equal(resolutions, 0);
});

test("proxy probe CLI parses supported duration units", () => {
  assert.equal(parseDurationMs("30s"), 30_000);
  assert.equal(parseDurationMs("2m"), 120_000);
  assert.equal(parseDurationMs("1h"), 3_600_000);
  assert.throws(() => parseDurationMs("500ms"), /Invalid duration/);
});

test("proxy probe CLI requires an executable use case", async () => {
  await assert.rejects(
    () => runProxyPoolProbeCommand({ argv: [], useCase: {} }),
    /proxy pool probe useCase must expose execute\(\)/
  );
});
