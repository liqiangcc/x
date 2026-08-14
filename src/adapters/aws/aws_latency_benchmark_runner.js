"use strict";

const {
  normalizeLatencyOptions,
  runLatencyBenchmark,
} = require("../../aws/latency");

function createAwsLatencyBenchmarkRunner({
  normalizeOptions = normalizeLatencyOptions,
  runBenchmark = runLatencyBenchmark,
} = {}) {
  return {
    run({ config = {}, options = {} } = {}) {
      return runBenchmark(normalizeOptions(options, config));
    },
  };
}

module.exports = {
  createAwsLatencyBenchmarkRunner,
};
