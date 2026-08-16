"use strict";

const {
  assertProxyBenchmarkReportWriter,
} = require("../../ports/proxy/proxy_diagnostics");
const {
  assertProxyPoolBenchmarkRunner,
} = require("../../ports/proxy/proxy_benchmark");

class RunProxyPoolBenchmarkUseCase {
  constructor({ benchmarkRunner, reportWriter } = {}) {
    this.benchmarkRunner = assertProxyPoolBenchmarkRunner(benchmarkRunner);
    this.reportWriter = assertProxyBenchmarkReportWriter(reportWriter);
  }

  async execute({ samples = 100, concurrency = 4 } = {}) {
    const report = await this.benchmarkRunner.run({ samples, concurrency });
    const reportPath = await this.reportWriter.write(report, "benchmark");
    return {
      ...report,
      report: reportPath,
    };
  }
}

module.exports = {
  RunProxyPoolBenchmarkUseCase,
};
