"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createProxyPoolWarmupCommand,
  parseDurationMs,
  runProxyPoolWarmupCommand,
} = require("../src/adapters/cli/commands/proxy_pool_warmup");

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

test("proxy warmup CLI preserves defaults and JSON presentation", async () => {
  const stdout = outputSink();
  const exitCodes = [];
  let request = null;
  const command = createProxyPoolWarmupCommand({
    stdout: stdout.stream,
    setExitCode(code) {
      exitCodes.push(code);
    },
    useCase: {
      async execute(value) {
        request = value;
        return { duration_ms: value.durationMs, rounds: [], passed: true, report: "runs/report.json" };
      },
    },
  });

  const report = await command([]);

  assert.deepEqual(request, {
    durationMs: 1_800_000,
    samples: 20,
    concurrency: 4,
  });
  assert.equal(stdout.value(), `${JSON.stringify(report, null, 2)}\n`);
  assert.deepEqual(exitCodes, []);
});

test("proxy warmup CLI maps explicit duration and numeric options", async () => {
  let request = null;
  await runProxyPoolWarmupCommand({
    argv: ["--duration", "2m", "--samples", "30", "--concurrency", "6", "--json"],
    useCase: {
      async execute(value) {
        request = value;
        return { passed: true };
      },
    },
    stdout: { write() {} },
  });

  assert.deepEqual(request, {
    durationMs: 120_000,
    samples: 30,
    concurrency: 6,
  });
});

test("proxy warmup CLI preserves exit code 2 when no round passes", async () => {
  const exitCodes = [];
  const report = await runProxyPoolWarmupCommand({
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

test("proxy warmup CLI validates protocol before resolving infrastructure", async () => {
  let resolutions = 0;
  const getUseCase = () => {
    resolutions += 1;
    return { execute: async () => ({}) };
  };

  await assert.rejects(
    () => runProxyPoolWarmupCommand({ argv: ["--duration", "0m"], getUseCase }),
    /Invalid duration: 0m/
  );
  assert.equal(resolutions, 0);

  await assert.rejects(
    () => runProxyPoolWarmupCommand({ argv: ["--samples", "0"], getUseCase }),
    /--samples must be a positive integer/
  );
  assert.equal(resolutions, 0);

  await assert.rejects(
    () => runProxyPoolWarmupCommand({ argv: ["--concurrency", "0"], getUseCase }),
    /--concurrency must be a positive integer/
  );
  assert.equal(resolutions, 0);

  await assert.rejects(
    () => runProxyPoolWarmupCommand({ argv: ["--duration"], getUseCase }),
    /Missing value for --duration/
  );
  assert.equal(resolutions, 0);
});

test("proxy warmup CLI parses supported duration units", () => {
  assert.equal(parseDurationMs("30s"), 30_000);
  assert.equal(parseDurationMs("2m"), 120_000);
  assert.equal(parseDurationMs("1h"), 3_600_000);
  assert.throws(() => parseDurationMs("500ms"), /Invalid duration/);
});

test("proxy warmup CLI requires an executable use case", async () => {
  await assert.rejects(
    () => runProxyPoolWarmupCommand({ argv: [], useCase: {} }),
    /proxy pool warmup useCase must expose execute\(\)/
  );
});
