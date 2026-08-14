"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  RunKlineEngineBenchmarkUseCase,
  RunProxySyncBenchmarkUseCase,
} = require("../src/application/benchmarks/run_benchmarks");

test("kline engine benchmark runs before allocating persistent run storage", async () => {
  const calls = [];
  const useCase = new RunKlineEngineBenchmarkUseCase({
    engineBenchmarkRunner: {
      async run(request) {
        calls.push(["run", request]);
        return {
          input: "600519",
          lmt: 1,
          period: "daily",
          summary: {},
        };
      },
    },
    benchmarkRunStore: {
      async createRun({ kind }) {
        calls.push(["createRun", kind]);
        return { runDir: "/runs/one" };
      },
      async readSummary() {
        throw new Error("not used");
      },
      async writeReport({ report }) {
        calls.push(["writeReport", report.input]);
        return "runs/benchmark/kline-engines/one/report.json";
      },
    },
  });

  const result = await useCase.execute({ engines: "local" });
  assert.deepEqual(calls, [
    ["run", { engines: "local" }],
    ["createRun", "kline-engines"],
    ["writeReport", "600519"],
  ]);
  assert.equal(
    result.report.report,
    "runs/benchmark/kline-engines/one/report.json"
  );
  assert.equal(result.exitCode, 0);
});

test("kline engine benchmark does not allocate storage when the runner fails", async () => {
  let created = false;
  const useCase = new RunKlineEngineBenchmarkUseCase({
    engineBenchmarkRunner: {
      async run() {
        throw new Error("invalid benchmark input");
      },
    },
    benchmarkRunStore: {
      async createRun() {
        created = true;
      },
      async readSummary() {},
      async writeReport() {},
    },
  });

  await assert.rejects(useCase.execute({}), /invalid benchmark input/);
  assert.equal(created, false);
});

test("proxy sync benchmark composes runner, summary, report, and exit code", async () => {
  const calls = [];
  const useCase = new RunProxySyncBenchmarkUseCase({
    proxySyncBenchmarkRunner: {
      async run(request) {
        calls.push(["run", request]);
        return {
          durationMs: 123,
          exitCode: 7,
          stderr: "partial failure",
          stdout: "",
        };
      },
    },
    benchmarkRunStore: {
      async createRun({ kind }) {
        calls.push(["createRun", kind]);
        return { outputDir: "/runs/one/data", runDir: "/runs/one" };
      },
      async readSummary({ period }) {
        calls.push(["readSummary", period]);
        return { status: "completed_with_failures" };
      },
      async writeReport({ report }) {
        calls.push(["writeReport", report.exit_code]);
        return "runs/benchmark/proxy-sync/one/report.json";
      },
    },
  });

  const result = await useCase.execute({
    codes: "/repo/codes.json",
    expectedLatestDate: "20260814",
    period: "yearly",
    samples: "20",
  });

  assert.deepEqual(calls, [
    ["createRun", "proxy-sync"],
    [
      "run",
      {
        codes: "/repo/codes.json",
        expectedLatestDate: "20260814",
        outputDir: "/runs/one/data",
        period: "yearly",
        samples: "20",
      },
    ],
    ["readSummary", "yearly"],
    ["writeReport", 7],
  ]);
  assert.deepEqual(result.report.summary, {
    status: "completed_with_failures",
  });
  assert.equal(result.report.error, null);
  assert.equal(result.report.samples, 20);
  assert.equal(result.exitCode, 7);
});

test("proxy sync benchmark preserves process error when no summary exists", async () => {
  const useCase = new RunProxySyncBenchmarkUseCase({
    proxySyncBenchmarkRunner: {
      async run() {
        return {
          durationMs: 10,
          exitCode: 1,
          stderr: "boom",
          stdout: "ignored",
        };
      },
    },
    benchmarkRunStore: {
      async createRun() {
        return { outputDir: "/tmp/data", runDir: "/tmp/run" };
      },
      async readSummary() {
        return null;
      },
      async writeReport() {
        return "runs/report.json";
      },
    },
  });

  const result = await useCase.execute({ codes: "/repo/codes.json" });
  assert.equal(result.report.error, "boom");
});

test("benchmark application contracts stay narrow", async () => {
  assert.throws(
    () =>
      new RunKlineEngineBenchmarkUseCase({
        engineBenchmarkRunner: {},
        benchmarkRunStore: {},
      }),
    /engineBenchmarkRunner is missing methods: run/
  );
  assert.throws(
    () =>
      new RunProxySyncBenchmarkUseCase({
        proxySyncBenchmarkRunner: { run() {} },
        benchmarkRunStore: { createRun() {}, writeReport() {} },
      }),
    /benchmarkRunStore is missing methods: readSummary/
  );
});
