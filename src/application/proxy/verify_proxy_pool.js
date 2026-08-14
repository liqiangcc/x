"use strict";

const {
  assertProxyPoolVerifier,
  assertProxyVerificationReportWriter,
} = require("../../ports/proxy/proxy_verification");

class VerifyProxyPoolUseCase {
  constructor({ verifier, reportWriter } = {}) {
    this.verifier = assertProxyPoolVerifier(verifier);
    this.reportWriter = assertProxyVerificationReportWriter(reportWriter);
  }

  async execute({ concurrency = 8, timeoutMs = 6000, limit, output = null } = {}) {
    const verifyOptions = { concurrency, timeoutMs };
    if (limit !== undefined) {
      verifyOptions.limit = limit;
    }

    const report = await this.verifier.verify(verifyOptions);
    const files = await this.reportWriter.write({ output, report });
    return { ...report, files };
  }
}

module.exports = {
  VerifyProxyPoolUseCase,
};
