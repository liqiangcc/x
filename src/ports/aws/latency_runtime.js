"use strict";

const LATENCY_CONFIG_READER_METHODS = Object.freeze(["read"]);
const LATENCY_BENCHMARK_RUNNER_METHODS = Object.freeze(["run"]);
const LATENCY_REPORT_WRITER_METHODS = Object.freeze(["write"]);

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

function assertLatencyConfigReader(implementation) {
  return assertMethods(
    implementation,
    LATENCY_CONFIG_READER_METHODS,
    "latencyConfigReader"
  );
}

function assertLatencyBenchmarkRunner(implementation) {
  return assertMethods(
    implementation,
    LATENCY_BENCHMARK_RUNNER_METHODS,
    "latencyBenchmarkRunner"
  );
}

function assertLatencyReportWriter(implementation) {
  return assertMethods(
    implementation,
    LATENCY_REPORT_WRITER_METHODS,
    "latencyReportWriter"
  );
}

module.exports = {
  LATENCY_BENCHMARK_RUNNER_METHODS,
  LATENCY_CONFIG_READER_METHODS,
  LATENCY_REPORT_WRITER_METHODS,
  assertLatencyBenchmarkRunner,
  assertLatencyConfigReader,
  assertLatencyReportWriter,
};
