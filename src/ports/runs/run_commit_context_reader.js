"use strict";

const RUN_COMMIT_CONTEXT_READER_METHODS = Object.freeze(["readCommitContext"]);

function assertRunCommitContextReader(implementation) {
  if (!implementation || typeof implementation !== "object") {
    throw new TypeError("runCommitContextReader implementation must be an object.");
  }
  const missing = RUN_COMMIT_CONTEXT_READER_METHODS.filter(
    (method) => typeof implementation[method] !== "function"
  );
  if (missing.length > 0) {
    throw new TypeError(`runCommitContextReader is missing methods: ${missing.join(", ")}`);
  }
  return implementation;
}

module.exports = {
  RUN_COMMIT_CONTEXT_READER_METHODS,
  assertRunCommitContextReader,
};
