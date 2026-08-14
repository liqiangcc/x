"use strict";

const {
  assertBenchmarkRunStore,
  assertEngineBenchmarkRunner,
  assertProxySyncBenchmarkRunner,
} = require("../../ports/benchmarks/benchmark_runtime");

class RunKlineEngineBenchmarkUseCase {
  constructor({ engineBenchmarkRunner, benchmarkRunStore } = {}) {
    this.engineBenchmarkRunner = assertEngineBenchmarkRunner(engineBenchmarkRunner);
    this.benchmarkRunStore = assertBenchmarkRunStore(benchmarkRunStore);
  }

  async execute(request = {}) {
    const report = await this.engineBenchmarkRunner.run(request);
    if (!report || typeof report !== "object" || Array.isArray(report)) {
      throw new TypeError("engineBenchmarkRunner.run() must return an object.");
    }
    const run = await this.benchmarkRunStore.createRun({ kind: "kline-engines" });
    const reportPath = await this.benchmarkRunStore.writeReport({ run, report });
    return {
      exitCode: 0,
      report: { ...report, report: reportPath },
    };
  }
}

class RunProxySyncBenchmarkUseCase {
  constructor({ proxySyncBenchmarkRunner, benchmarkRunStore } = {}) {
    this.proxySyncBenchmarkRunner = assertProxySyncBenchmarkRunner(
      proxySyncBenchmarkRunner
    );
    this.benchmarkRunStore = assertBenchmarkRunStore(benchmarkRunStore);
  }

  async execute({
    codes,
    expectedLatestDate = null,
    period = "daily",
    samples = "100",
  } = {}) {
    if (!codes) {
      throw new Error("benchmark proxy-sync requires --codes <codes.json>.");
    }

    const run = await this.benchmarkRunStore.createRun({ kind: "proxy-sync" });
    const result = await this.proxySyncBenchmarkRunner.run({
      codes,
      expectedLatestDate,
      outputDir: run.outputDir,
      period,
      samples,
    });
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      throw new TypeError("proxySyncBenchmarkRunner.run() must return an object.");
    }

    const summary = await this.benchmarkRunStore.readSummary({ run, period });
    const report = {
      benchmark: "proxy-sync",
      codes,
      duration_ms: result.durationMs,
      error: summary ? null : result.stderr || result.stdout || null,
      exit_code: result.exitCode,
      period,
      samples: Number(samples),
      summary,
    };
    const reportPath = await this.benchmarkRunStore.writeReport({ run, report });
    report.report = reportPath;
    return { exitCode: result.exitCode, report };
  }
}

module.exports = {
  RunKlineEngineBenchmarkUseCase,
  RunProxySyncBenchmarkUseCase,
};
