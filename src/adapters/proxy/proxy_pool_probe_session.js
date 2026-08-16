"use strict";

function createDefaultRuntime() {
  const {
    classifyProxyError,
    cooldownMs,
    DEFAULT_STATE_FILE,
  } = require("../../proxy/pool");
  const { ProxyBatchRuntime } = require("../../proxy/runtime");
  return new ProxyBatchRuntime({
    classifyError: classifyProxyError,
    cooldownForError: cooldownMs,
    stateFile: DEFAULT_STATE_FILE,
  });
}

function createProxyPoolProbeSessionFactory({ runtimeFactory = createDefaultRuntime } = {}) {
  return {
    open() {
      const runtime = runtimeFactory();
      return {
        async sample({ concurrency, samples, startIndex, timeoutMs } = {}) {
          return runtime.prepare({
            concurrency,
            limit: samples,
            minAvailable: 0,
            minSuccessRate: 0,
            startIndex,
            timeoutMs,
          });
        },
        async close() {
          await runtime.close();
        },
      };
    },
  };
}

module.exports = {
  createProxyPoolProbeSessionFactory,
};
