"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const {
  createBenchmarkCommand,
  parseBenchmarkOptions,
  runBenchmarkCommand,
} = require("../src/adapters/cli/commands/benchmark");

function captureWriter() {
  let text = "";
  return {
    write(chunk) {
      text += chunk;
    },
    text() {
      return text;
    },
  };
}

test("kline-engines maps config path and preserves text presentation", async () => {
  const stdout = captureWriter();
  const calls = [];
  await runBenchmarkCommand({
    argv: ["kline-engines", "--config", "config/local.json"],
    root: "/repo",
    stdout,
    klineEngineBenchmarkUseCase: {
      async execute(request) {
        calls.push(request);
        return {
          exitCode: 0,
          report: {
            input: "600519",
            lmt: 1,
            period: "daily",
            report: "runs/benchmark/kline-engines/r/report.json",
            summary: {
              local: {
                attempts: 2,
                success: 2,
                avg_ms: 10,
                p50_ms: 9,
                p95_ms: 11,
                p99_ms: 11,
                error_counts: {},
              },
            },
          },
        };
      },
    },
  });

  assert.equal(calls[0].config, path.join("/repo", "config/local.json"));
  assert.equal(
    stdout.text(),
    "Kline engine benchmark: 600519 daily lmt=1\n" +
      "engine\tsuccess\tavg_ms\tp50_ms\tp95_ms\tp99_ms\terrors\n" +
      "local\t2/2\t10\t9\t11\t11\t{}\n" +
      "Report: runs/benchmark/kline-engines/r/report.json\n"
  );
});

test("kline-engines preserves JSON presentation", async () => {
  const stdout = captureWriter();
  const report = { input: "600519", period: "daily", lmt: 1, summary: {} };
  await runBenchmarkCommand({
    argv: ["kline-engines", "--json"],
    root: "/repo",
    stdout,
    klineEngineBenchmarkUseCase: {
      async execute() {
        return { exitCode: 0, report };
      },
    },
  });
  assert.equal(stdout.text(), `${JSON.stringify(report, null, 2)}\n`);
});

test("proxy-sync preserves defaults, root path mapping, JSON, and exit code", async () => {
  const stdout = captureWriter();
  const exitCodes = [];
  const calls = [];
  const report = { benchmark: "proxy-sync", exit_code: 3 };
  await runBenchmarkCommand({
    argv: ["proxy-sync", "--codes", "data/codes.json"],
    root: "/repo",
    stdout,
    setExitCode: (code) => exitCodes.push(code),
    proxySyncBenchmarkUseCase: {
      async execute(request) {
        calls.push(request);
        return { exitCode: 3, report };
      },
    },
  });

  assert.deepEqual(calls, [
    {
      codes: path.join("/repo", "data/codes.json"),
      expectedLatestDate: null,
      period: "daily",
      samples: "100",
    },
  ]);
  assert.deepEqual(exitCodes, [3]);
  assert.equal(stdout.text(), `${JSON.stringify(report, null, 2)}\n`);
});

test("benchmark CLI preserves parser and exact errors", async () => {
  assert.equal(parseBenchmarkOptions(["--json"]).json, true);
  await assert.rejects(
    runBenchmarkCommand({ argv: ["unknown"], root: "/repo" }),
    /Unknown benchmark: unknown/
  );
  await assert.rejects(
    runBenchmarkCommand({ argv: ["proxy-sync"], root: "/repo" }),
    /benchmark proxy-sync requires --codes <codes\.json>\./
  );
});

test("createBenchmarkCommand keeps infrastructure lazy for protocol-only failures", async () => {
  const command = createBenchmarkCommand({ root: "/repo", runsDir: "/repo/runs" });
  await assert.rejects(command(["unknown"]), /Unknown benchmark: unknown/);
  await assert.rejects(
    command(["proxy-sync"]),
    /benchmark proxy-sync requires --codes <codes\.json>\./
  );
});

test("createBenchmarkCommand accepts explicit use cases without default adapters", async () => {
  const stdout = captureWriter();
  const command = createBenchmarkCommand({
    root: "/repo",
    runsDir: "/repo/runs",
    stdout,
    klineEngineBenchmarkUseCase: {
      async execute() {
        return {
          exitCode: 0,
          report: {
            input: "600519",
            lmt: 1,
            period: "daily",
            report: "report.json",
            summary: {},
          },
        };
      },
    },
  });
  await command(["kline-engines", "--json"]);
  assert.match(stdout.text(), /"input": "600519"/);
});
