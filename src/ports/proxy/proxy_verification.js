"use strict";

function assertCapability(value, method, name) {
  if (!value || typeof value[method] !== "function") {
    throw new TypeError(`${name} must expose ${method}().`);
  }
  return value;
}

function assertProxyPoolVerifier(value) {
  return assertCapability(value, "verify", "ProxyPoolVerifier");
}

function assertProxyVerificationReportWriter(value) {
  return assertCapability(value, "write", "ProxyVerificationReportWriter");
}

module.exports = {
  assertProxyPoolVerifier,
  assertProxyVerificationReportWriter,
};
