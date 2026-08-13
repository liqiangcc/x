"use strict";

const SECURITY_MASTER_TIMELINE_READER_METHODS = Object.freeze(["readTimeline"]);

function assertSecurityMasterTimelineReader(implementation) {
  if (!implementation || typeof implementation !== "object") {
    throw new TypeError("securityMasterTimelineReader implementation must be an object.");
  }
  const missing = SECURITY_MASTER_TIMELINE_READER_METHODS.filter(
    (method) => typeof implementation[method] !== "function"
  );
  if (missing.length > 0) {
    throw new TypeError(
      `securityMasterTimelineReader is missing methods: ${missing.join(", ")}`
    );
  }
  return implementation;
}

module.exports = {
  SECURITY_MASTER_TIMELINE_READER_METHODS,
  assertSecurityMasterTimelineReader,
};
