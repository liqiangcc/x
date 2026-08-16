"use strict";

function assertCapability(value, method, name) {
  if (!value || typeof value[method] !== "function") {
    throw new TypeError(`${name} must expose ${method}().`);
  }
  return value;
}

function assertProxyPoolDiagnosticRunner(value) {
  return assertCapability(value, "run", "ProxyPoolDiagnosticRunner");
}

function assertProxyBenchmarkReportWriter(value) {
  return assertCapability(value, "write", "ProxyBenchmarkReportWriter");
}

module.exports = {
  assertProxyBenchmarkReportWriter,
  assertProxyPoolDiagnosticRunner,
};
