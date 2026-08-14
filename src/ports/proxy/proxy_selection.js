"use strict";

function assertCapability(value, method, name) {
  if (!value || typeof value[method] !== "function") {
    throw new TypeError(`${name} must expose ${method}().`);
  }
  return value;
}

function assertProxyHealthStateReader(value) {
  return assertCapability(value, "read", "ProxyHealthStateReader");
}

function assertProxySelectionReportStore(value) {
  assertCapability(value, "readPrevious", "ProxySelectionReportStore");
  return assertCapability(value, "write", "ProxySelectionReportStore");
}

module.exports = {
  assertProxyHealthStateReader,
  assertProxySelectionReportStore,
};
