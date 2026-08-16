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

function createProxyPoolDiagnosticRunner({ runtimeFactory = createDefaultRuntime } = {}) {
  return {
    async run({ concurrency, samples, timeoutMs } = {}) {
      const runtime = runtimeFactory();
      try {
        return await runtime.prepare({
          concurrency,
          limit: samples,
          minAvailable: 0,
          minSuccessRate: 0,
          timeoutMs,
        });
      } finally {
        await runtime.close();
      }
    },
  };
}

module.exports = {
  createProxyPoolDiagnosticRunner,
};
