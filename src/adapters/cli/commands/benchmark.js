"use strict";

const path = require("node:path");
const {
  RunKlineEngineBenchmarkUseCase,
  RunProxySyncBenchmarkUseCase,
} = require("../../../application/benchmarks/run_benchmarks");
const { parseCliOptions } = require("../option_parser");

function parseBenchmarkOptions(argv, defaults = {}) {
  return parseCliOptions(argv, defaults);
}

function resolveRootPath(root, filePath) {
  return path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
}

function writeJson(stdout, payload) {
  stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function writeEngineBenchmarkText(stdout, report) {
  stdout.write(
    `Kline engine benchmark: ${report.input} ${report.period} lmt=${report.lmt}\n`
  );
  stdout.write("engine\tsuccess\tavg_ms\tp50_ms\tp95_ms\tp99_ms\terrors\n");
  for (const [engine, summary] of Object.entries(report.summary)) {
    stdout.write(
      `${[
        engine,
        `${summary.success}/${summary.attempts}`,
        summary.avg_ms ?? "n/a",
        summary.p50_ms ?? "n/a",
        summary.p95_ms ?? "n/a",
        summary.p99_ms ?? "n/a",
        JSON.stringify(summary.error_counts),
      ].join("\t")}\n`
    );
  }
  stdout.write(`Report: ${report.report}\n`);
}

async function runBenchmarkCommand({
  argv = [],
  getKlineEngineBenchmarkUseCase,
  getProxySyncBenchmarkUseCase,
  klineEngineBenchmarkUseCase,
  proxySyncBenchmarkUseCase,
  root,
  setExitCode = (code) => {
    process.exitCode = code;
  },
  stdout = process.stdout,
} = {}) {
  const kind = argv[0];

  if (kind === "kline-engines") {
    const options = parseBenchmarkOptions(argv.slice(1));
    if (options.config) options.config = resolveRootPath(root, options.config);
    const useCase =
      klineEngineBenchmarkUseCase ?? getKlineEngineBenchmarkUseCase?.();
    if (!useCase || typeof useCase.execute !== "function") {
      throw new TypeError("klineEngineBenchmarkUseCase must expose execute().");
    }
    const result = await useCase.execute(options);
    if (options.json) writeJson(stdout, result.report);
    else writeEngineBenchmarkText(stdout, result.report);
    if (result.exitCode !== 0) setExitCode(result.exitCode);
    return result.report;
  }

  if (kind !== "proxy-sync") {
    throw new Error(`Unknown benchmark: ${kind ?? ""}`);
  }

  const options = parseBenchmarkOptions(argv.slice(1), {
    period: "daily",
    samples: "100",
  });
  if (!options.codes) {
    throw new Error("benchmark proxy-sync requires --codes <codes.json>.");
  }
  const useCase = proxySyncBenchmarkUseCase ?? getProxySyncBenchmarkUseCase?.();
  if (!useCase || typeof useCase.execute !== "function") {
    throw new TypeError("proxySyncBenchmarkUseCase must expose execute().");
  }
  const result = await useCase.execute({
    codes: resolveRootPath(root, options.codes),
    expectedLatestDate: options.expectedLatestDate ?? null,
    period: options.period,
    samples: options.samples,
  });
  writeJson(stdout, result.report);
  if (result.exitCode !== 0) setExitCode(result.exitCode);
  return result.report;
}

function createBenchmarkCommand({
  root,
  runsDir,
  stdout = process.stdout,
  setExitCode,
  benchmarkRunStore,
  engineBenchmarkRunner,
  proxySyncBenchmarkRunner,
  klineEngineBenchmarkUseCase,
  proxySyncBenchmarkUseCase,
} = {}) {
  let resolvedRunStore = benchmarkRunStore;
  let resolvedEngineUseCase = klineEngineBenchmarkUseCase;
  let resolvedProxySyncUseCase = proxySyncBenchmarkUseCase;

  function getRunStore() {
    if (!resolvedRunStore) {
      const {
        createFilesystemBenchmarkRunStore,
      } = require("../../benchmarks/filesystem_benchmark_run_store");
      resolvedRunStore = createFilesystemBenchmarkRunStore({ root, runsDir });
    }
    return resolvedRunStore;
  }

  function getKlineEngineBenchmarkUseCase() {
    if (!resolvedEngineUseCase) {
      let resolvedRunner = engineBenchmarkRunner;
      if (!resolvedRunner) {
        const {
          runEngineBenchmark,
        } = require("../../../kline/engine_benchmark");
        resolvedRunner = { run: runEngineBenchmark };
      }
      resolvedEngineUseCase = new RunKlineEngineBenchmarkUseCase({
        benchmarkRunStore: getRunStore(),
        engineBenchmarkRunner: resolvedRunner,
      });
    }
    return resolvedEngineUseCase;
  }

  function getProxySyncBenchmarkUseCase() {
    if (!resolvedProxySyncUseCase) {
      let resolvedRunner = proxySyncBenchmarkRunner;
      if (!resolvedRunner) {
        const {
          createNodeProxySyncBenchmarkRunner,
        } = require("../../benchmarks/node_proxy_sync_benchmark_runner");
        resolvedRunner = createNodeProxySyncBenchmarkRunner({ root });
      }
      resolvedProxySyncUseCase = new RunProxySyncBenchmarkUseCase({
        benchmarkRunStore: getRunStore(),
        proxySyncBenchmarkRunner: resolvedRunner,
      });
    }
    return resolvedProxySyncUseCase;
  }

  return (argv) =>
    runBenchmarkCommand({
      argv,
      getKlineEngineBenchmarkUseCase,
      getProxySyncBenchmarkUseCase,
      klineEngineBenchmarkUseCase,
      proxySyncBenchmarkUseCase,
      root,
      setExitCode,
      stdout,
    });
}

module.exports = {
  createBenchmarkCommand,
  parseBenchmarkOptions,
  resolveRootPath,
  runBenchmarkCommand,
  writeEngineBenchmarkText,
};
