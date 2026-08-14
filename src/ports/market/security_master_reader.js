"use strict";

const SECURITY_MASTER_READER_METHODS = Object.freeze(["readRecord"]);
const SECURITY_MASTER_SNAPSHOT_READER_METHODS = Object.freeze(["readSnapshot"]);

function assertMethods(implementation, methods, label) {
  if (!implementation || typeof implementation !== "object") {
    throw new TypeError(`${label} implementation must be an object.`);
  }
  const missing = methods.filter(
    (method) => typeof implementation[method] !== "function"
  );
  if (missing.length > 0) {
    throw new TypeError(`${label} is missing methods: ${missing.join(", ")}`);
  }
  return implementation;
}

function assertSecurityMasterReader(implementation) {
  return assertMethods(
    implementation,
    SECURITY_MASTER_READER_METHODS,
    "securityMasterReader"
  );
}

function assertSecurityMasterSnapshotReader(implementation) {
  return assertMethods(
    implementation,
    SECURITY_MASTER_SNAPSHOT_READER_METHODS,
    "securityMasterSnapshotReader"
  );
}

module.exports = {
  SECURITY_MASTER_READER_METHODS,
  SECURITY_MASTER_SNAPSHOT_READER_METHODS,
  assertSecurityMasterReader,
  assertSecurityMasterSnapshotReader,
};
