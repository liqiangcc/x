"use strict";

function assertProxyPoolProbeSessionFactory(value) {
  if (!value || typeof value.open !== "function") {
    throw new TypeError("ProxyPoolProbeSessionFactory must expose open().");
  }
  return value;
}

function assertProxyPoolProbeSession(value) {
  if (!value || typeof value.sample !== "function") {
    throw new TypeError("ProxyPoolProbeSession must expose sample().");
  }
  if (typeof value.close !== "function") {
    throw new TypeError("ProxyPoolProbeSession must expose close().");
  }
  return value;
}

module.exports = {
  assertProxyPoolProbeSession,
  assertProxyPoolProbeSessionFactory,
};
