"use strict";

const {
  assertProxyBenchmarkReportWriter,
  assertProxyPoolDiagnosticRunner,
} = require("../../ports/proxy/proxy_diagnostics");

function buildProxyDiagnosticReport(rawReport) {
  return {
    ...rawReport,
    target: "eastmoney-kline",
    passed: Number(rawReport?.available_count ?? 0) > 0,
  };
}

class DiagnoseProxyPoolUseCase {
  constructor({ diagnosticRunner, reportWriter } = {}) {
    this.diagnosticRunner = assertProxyPoolDiagnosticRunner(diagnosticRunner);
    this.reportWriter = assertProxyBenchmarkReportWriter(reportWriter);
  }

  async execute({ concurrency = 16, samples = 100, timeoutMs = 3000 } = {}) {
    const rawReport = await this.diagnosticRunner.run({ concurrency, samples, timeoutMs });
    const report = buildProxyDiagnosticReport(rawReport);
    const reportPath = await this.reportWriter.write(report, "diagnose");
    return {
      ...report,
      report: reportPath,
    };
  }
}

module.exports = {
  DiagnoseProxyPoolUseCase,
  buildProxyDiagnosticReport,
};
