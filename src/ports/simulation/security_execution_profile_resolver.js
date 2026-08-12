"use strict";

const SECURITY_EXECUTION_PROFILE_RESOLVER_METHODS = Object.freeze(["resolve"]);

function assertSecurityExecutionProfileResolver(implementation) {
  if (!implementation || typeof implementation !== "object") {
    throw new TypeError("securityExecutionProfileResolver implementation must be an object.");
  }
  const missing = SECURITY_EXECUTION_PROFILE_RESOLVER_METHODS.filter(
    (method) => typeof implementation[method] !== "function"
  );
  if (missing.length > 0) {
    throw new TypeError(`securityExecutionProfileResolver is missing methods: ${missing.join(", ")}`);
  }
  return implementation;
}

module.exports = {
  SECURITY_EXECUTION_PROFILE_RESOLVER_METHODS,
  assertSecurityExecutionProfileResolver,
};
