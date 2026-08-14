"use strict";

const {
  assertLatencyBenchmarkRunner,
  assertLatencyConfigReader,
  assertLatencyReportWriter,
} = require("../../ports/aws/latency_runtime");

class RunAwsLatencyBenchmarkUseCase {
  constructor({ configReader, benchmarkRunner, reportWriter } = {}) {
    this.configReader = assertLatencyConfigReader(configReader);
    this.benchmarkRunner = assertLatencyBenchmarkRunner(benchmarkRunner);
    this.reportWriter = assertLatencyReportWriter(reportWriter);
  }

  async execute({ config = null, output = null, options = {} } = {}) {
    const latencyConfig = await this.configReader.read({ config });
    const report = await this.benchmarkRunner.run({
      config: latencyConfig,
      options,
    });

    if (output) {
      await this.reportWriter.write({ output, report });
    }

    return report;
  }
}

module.exports = {
  RunAwsLatencyBenchmarkUseCase,
};
