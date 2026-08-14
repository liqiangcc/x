"use strict";

const ROUTER_PROBE_CLIENT_METHODS = Object.freeze(["probe"]);

function assertRouterProbeClient(implementation) {
  if (!implementation || typeof implementation !== "object") {
    throw new TypeError("routerProbeClient implementation must be an object.");
  }

  const missing = ROUTER_PROBE_CLIENT_METHODS.filter(
    (method) => typeof implementation[method] !== "function"
  );
  if (missing.length > 0) {
    throw new TypeError(
      `routerProbeClient is missing methods: ${missing.join(", ")}`
    );
  }
  return implementation;
}

module.exports = {
  ROUTER_PROBE_CLIENT_METHODS,
  assertRouterProbeClient,
};
