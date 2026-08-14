"use strict";

const EXECUTION_PROFILE_TIMELINE_READER_METHODS = Object.freeze(["readTimeline"]);

function assertExecutionProfileTimelineReader(implementation) {
  if (!implementation || typeof implementation !== "object") {
    throw new TypeError("executionProfileTimelineReader implementation must be an object.");
  }
  const missing = EXECUTION_PROFILE_TIMELINE_READER_METHODS.filter(
    (method) => typeof implementation[method] !== "function"
  );
  if (missing.length > 0) {
    throw new TypeError(
      `executionProfileTimelineReader is missing methods: ${missing.join(", ")}`
    );
  }
  return implementation;
}

module.exports = {
  EXECUTION_PROFILE_TIMELINE_READER_METHODS,
  assertExecutionProfileTimelineReader,
};
