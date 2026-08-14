"use strict";

const SECURITY_MASTER_WRITER_METHODS = Object.freeze(["writeRecords"]);

function assertSecurityMasterWriter(implementation) {
  if (!implementation || typeof implementation !== "object") {
    throw new TypeError("securityMasterWriter implementation must be an object.");
  }
  const missing = SECURITY_MASTER_WRITER_METHODS.filter(
    (method) => typeof implementation[method] !== "function"
  );
  if (missing.length > 0) {
    throw new TypeError(`securityMasterWriter is missing methods: ${missing.join(", ")}`);
  }
  return implementation;
}

module.exports = {
  SECURITY_MASTER_WRITER_METHODS,
  assertSecurityMasterWriter,
};
