"use strict";

const RUN_READER_METHODS = Object.freeze([
  "listRunIds",
  "readArtifact",
]);

function assertRunReader(implementation) {
  if (!implementation || typeof implementation !== "object") {
    throw new TypeError("runReader implementation must be an object.");
  }

  const missing = RUN_READER_METHODS.filter(
    (method) => typeof implementation[method] !== "function"
  );
  if (missing.length > 0) {
    throw new TypeError(`runReader is missing methods: ${missing.join(", ")}`);
  }
  return implementation;
}

module.exports = {
  RUN_READER_METHODS,
  assertRunReader,
};
