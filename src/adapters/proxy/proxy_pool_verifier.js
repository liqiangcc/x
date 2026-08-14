"use strict";

function createProxyPoolVerifier({ validateAllProxiesImpl } = {}) {
  let resolvedValidateAllProxies = validateAllProxiesImpl;

  function getValidateAllProxies() {
    if (!resolvedValidateAllProxies) {
      ({ validateAllProxies: resolvedValidateAllProxies } = require("../../proxy/pool"));
    }
    return resolvedValidateAllProxies;
  }

  return {
    verify(options = {}) {
      return getValidateAllProxies()(options);
    },
  };
}

module.exports = {
  createProxyPoolVerifier,
};
