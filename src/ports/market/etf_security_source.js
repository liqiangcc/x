"use strict";

const ETF_SECURITY_SOURCE_METHODS = Object.freeze(["fetchFacts"]);

function assertEtfSecuritySource(implementation) {
  if (!implementation || typeof implementation !== "object") {
    throw new TypeError("etfSecuritySource implementation must be an object.");
  }
  const missing = ETF_SECURITY_SOURCE_METHODS.filter(
    (method) => typeof implementation[method] !== "function"
  );
  if (missing.length > 0) {
    throw new TypeError(`etfSecuritySource is missing methods: ${missing.join(", ")}`);
  }
  return implementation;
}

module.exports = {
  ETF_SECURITY_SOURCE_METHODS,
  assertEtfSecuritySource,
};
