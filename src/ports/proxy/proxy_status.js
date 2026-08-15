"use strict";

function assertCapability(value, method, name) {
  if (!value || typeof value[method] !== "function") {
    throw new TypeError(`${name} must expose ${method}().`);
  }
  return value;
}

function assertProxyPoolRuntimeInspector(value) {
  return assertCapability(value, "inspect", "ProxyPoolRuntimeInspector");
}

function assertProxyPoolCandidateCounter(value) {
  return assertCapability(value, "count", "ProxyPoolCandidateCounter");
}

module.exports = {
  assertProxyPoolCandidateCounter,
  assertProxyPoolRuntimeInspector,
};
