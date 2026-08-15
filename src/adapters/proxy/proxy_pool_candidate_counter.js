"use strict";

function createProxyPoolCandidateCounter({ fetchAllProxyCandidatesImpl } = {}) {
  let resolvedFetchAllProxyCandidates = fetchAllProxyCandidatesImpl;

  function getFetchAllProxyCandidates() {
    if (!resolvedFetchAllProxyCandidates) {
      ({ fetchAllProxyCandidates: resolvedFetchAllProxyCandidates } = require("../../proxy/pool"));
    }
    return resolvedFetchAllProxyCandidates;
  }

  return {
    async count() {
      const candidates = await getFetchAllProxyCandidates()();
      return candidates.length;
    },
  };
}

module.exports = {
  createProxyPoolCandidateCounter,
};
