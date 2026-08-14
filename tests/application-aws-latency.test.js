"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  RunAwsLatencyBenchmarkUseCase,
} = require("../src/application/aws/run_latency_benchmark");

test("latency use case reads config, runs benchmark, then persists requested report", async () => {
  const calls = [];
  const report = { engine: "aws", results: [] };
  const useCase = new RunAwsLatencyBenchmarkUseCase({
    configReader: {
      async read(request) {
        calls.push(["read", request]);
        return { lambda_name: "configured-kline" };
      },
    },
    benchmarkRunner: {
      async run(request) {
        calls.push(["run", request]);
        return report;
      },
    },
    reportWriter: {
      async write(request) {
        calls.push(["write", request]);
      },
    },
  });

  assert.equal(
    await useCase.execute({
      config: "config/custom.json",
      output: "runs/latency.json",
      options: { attempts: "2", engine: "aws" },
    }),
    report
  );
  assert.deepEqual(calls, [
    ["read", { config: "config/custom.json" }],
    ["run", {
      config: { lambda_name: "configured-kline" },
      options: { attempts: "2", engine: "aws" },
    }],
    ["write", { output: "runs/latency.json", report }],
  ]);
});

test("latency use case does not persist when output is omitted", async () => {
  let writes = 0;
  const report = { engine: "aws-router", results: [] };
  const useCase = new RunAwsLatencyBenchmarkUseCase({
    configReader: { async read() { return {}; } },
    benchmarkRunner: { async run() { return report; } },
    reportWriter: { async write() { writes += 1; } },
  });

  assert.equal(
    await useCase.execute({ options: { engine: "aws-router" } }),
    report
  );
  assert.equal(writes, 0);
});

test("latency use case requires each narrow runtime capability", () => {
  const validReader = { read() {} };
  const validRunner = { run() {} };
  const validWriter = { write() {} };

  assert.throws(
    () => new RunAwsLatencyBenchmarkUseCase({
      benchmarkRunner: validRunner,
      reportWriter: validWriter,
    }),
    /latencyConfigReader/
  );
  assert.throws(
    () => new RunAwsLatencyBenchmarkUseCase({
      configReader: validReader,
      reportWriter: validWriter,
    }),
    /latencyBenchmarkRunner/
  );
  assert.throws(
    () => new RunAwsLatencyBenchmarkUseCase({
      configReader: validReader,
      benchmarkRunner: validRunner,
    }),
    /latencyReportWriter/
  );
});
