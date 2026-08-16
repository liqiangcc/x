"use strict";

function createProxyPoolBenchmarkRunner({ runBenchmark } = {}) {
  return {
    async run({ samples, concurrency } = {}) {
      const resolvedRunBenchmark = runBenchmark ?? require("../../proxy/pool").runProxyBenchmark;
      return resolvedRunBenchmark({ samples, concurrency });
    },
  };
}

module.exports = {
  createProxyPoolBenchmarkRunner,
};
