"use strict";

const SECURITY_MASTER_READER_METHODS = Object.freeze(["readRecord"]);

function assertSecurityMasterReader(implementation) {
  if (!implementation || typeof implementation !== "object") {
    throw new TypeError("securityMasterReader implementation must be an object.");
  }
  const missing = SECURITY_MASTER_READER_METHODS.filter(
    (method) => typeof implementation[method] !== "function"
  );
  if (missing.length > 0) {
    throw new TypeError(`securityMasterReader is missing methods: ${missing.join(", ")}`);
  }
  return implementation;
}

module.exports = {
  SECURITY_MASTER_READER_METHODS,
  assertSecurityMasterReader,
};
