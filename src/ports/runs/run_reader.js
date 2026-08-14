"use strict";

const RUN_LIST_READER_METHODS = Object.freeze(["listRunIds"]);
const RUN_ARTIFACT_READER_METHODS = Object.freeze(["readArtifact"]);

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

function assertRunListReader(implementation) {
  return assertMethods(implementation, RUN_LIST_READER_METHODS, "runListReader");
}

function assertRunArtifactReader(implementation) {
  return assertMethods(
    implementation,
    RUN_ARTIFACT_READER_METHODS,
    "runArtifactReader"
  );
}

module.exports = {
  RUN_ARTIFACT_READER_METHODS,
  RUN_LIST_READER_METHODS,
  assertRunArtifactReader,
  assertRunListReader,
};
