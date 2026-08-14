"use strict";

const DATA_STATUS_WORKSPACE_METHODS = Object.freeze([
  "existingPathspecs",
  "status",
]);
const DATA_COMMIT_WORKSPACE_METHODS = Object.freeze([
  "existingPathspecs",
  "stage",
  "stagedFiles",
  "commit",
]);

function assertMethods(implementation, methods, label) {
  if (!implementation || typeof implementation !== "object") {
    throw new TypeError(`${label} implementation must be an object.`);
  }
  const missing = methods.filter((method) => typeof implementation[method] !== "function");
  if (missing.length > 0) {
    throw new TypeError(`${label} is missing methods: ${missing.join(", ")}`);
  }
  return implementation;
}

function assertDataStatusWorkspace(implementation) {
  return assertMethods(
    implementation,
    DATA_STATUS_WORKSPACE_METHODS,
    "dataStatusWorkspace"
  );
}

function assertDataCommitWorkspace(implementation) {
  return assertMethods(
    implementation,
    DATA_COMMIT_WORKSPACE_METHODS,
    "dataCommitWorkspace"
  );
}

module.exports = {
  DATA_COMMIT_WORKSPACE_METHODS,
  DATA_STATUS_WORKSPACE_METHODS,
  assertDataCommitWorkspace,
  assertDataStatusWorkspace,
};
