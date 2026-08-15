"use strict";

const {
  assertProxyPoolCandidateCounter,
  assertProxyPoolRuntimeInspector,
} = require("../../ports/proxy/proxy_status");

class CheckProxyPoolStatusUseCase {
  constructor({ runtimeInspector, candidateCounter } = {}) {
    this.runtimeInspector = assertProxyPoolRuntimeInspector(runtimeInspector);
    this.candidateCounter = assertProxyPoolCandidateCounter(candidateCounter);
  }

  async execute() {
    const runtime = await this.runtimeInspector.inspect();
    try {
      const cnCandidates = await this.candidateCounter.count();
      return {
        runtime,
        report: { ok: true, cn_candidates: cnCandidates },
        exitCode: 0,
      };
    } catch (error) {
      return {
        runtime,
        report: { ok: false, error: error.message, cn_candidates: 0 },
        exitCode: 1,
      };
    }
  }
}

module.exports = {
  CheckProxyPoolStatusUseCase,
};
