"use strict";

const ENGINE_BENCHMARK_RUNNER_METHODS = Object.freeze(["run"]);
const PROXY_SYNC_BENCHMARK_RUNNER_METHODS = Object.freeze(["run"]);
const BENCHMARK_RUN_STORE_METHODS = Object.freeze([
  "createRun",
  "readSummary",
  "writeReport",
]);

function assertMethods(implementation, methods, label) {
  if (!implementation || typeof implementation !== "object") {
    throw new TypeError(`${label} implementation must be an object.`);
  }
  const missing = methods.filter(
    (method) => typeof implementation[method] !== "function"
  );
  if (missing.length > 0) {
    throw new TypeError(`${label} is missing methods: ${missing.join(", ")}`);
  }
  return implementation;
}

function assertEngineBenchmarkRunner(implementation) {
  return assertMethods(
    implementation,
    ENGINE_BENCHMARK_RUNNER_METHODS,
    "engineBenchmarkRunner"
  );
}

function assertProxySyncBenchmarkRunner(implementation) {
  return assertMethods(
    implementation,
    PROXY_SYNC_BENCHMARK_RUNNER_METHODS,
    "proxySyncBenchmarkRunner"
  );
}

function assertBenchmarkRunStore(implementation) {
  return assertMethods(
    implementation,
    BENCHMARK_RUN_STORE_METHODS,
    "benchmarkRunStore"
  );
}

module.exports = {
  BENCHMARK_RUN_STORE_METHODS,
  ENGINE_BENCHMARK_RUNNER_METHODS,
  PROXY_SYNC_BENCHMARK_RUNNER_METHODS,
  assertBenchmarkRunStore,
  assertEngineBenchmarkRunner,
  assertProxySyncBenchmarkRunner,
};
