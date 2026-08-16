"use strict";

function assertProxyPoolBenchmarkRunner(value) {
  if (!value || typeof value.run !== "function") {
    throw new TypeError("ProxyPoolBenchmarkRunner must expose run().");
  }
  return value;
}

module.exports = {
  assertProxyPoolBenchmarkRunner,
};
