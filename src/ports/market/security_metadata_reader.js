"use strict";

const SECURITY_METADATA_READER_METHODS = Object.freeze(["readMetadata"]);

function assertSecurityMetadataReader(implementation) {
  if (!implementation || typeof implementation !== "object") {
    throw new TypeError("securityMetadataReader implementation must be an object.");
  }
  const missing = SECURITY_METADATA_READER_METHODS.filter(
    (method) => typeof implementation[method] !== "function"
  );
  if (missing.length > 0) {
    throw new TypeError(`securityMetadataReader is missing methods: ${missing.join(", ")}`);
  }
  return implementation;
}

module.exports = {
  SECURITY_METADATA_READER_METHODS,
  assertSecurityMetadataReader,
};
