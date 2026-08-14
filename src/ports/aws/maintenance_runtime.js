"use strict";

const AWS_MAINTENANCE_READER_METHODS = Object.freeze([
  "getToolVersion",
  "readCredentials",
  "getIdentity",
  "runKlinePreflight",
]);
const GITHUB_SETTINGS_WRITER_METHODS = Object.freeze([
  "resolveRepository",
  "setSecret",
  "setVariable",
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

function assertAwsMaintenanceReader(implementation) {
  return assertMethods(
    implementation,
    AWS_MAINTENANCE_READER_METHODS,
    "awsMaintenanceReader"
  );
}

function assertGitHubSettingsWriter(implementation) {
  return assertMethods(
    implementation,
    GITHUB_SETTINGS_WRITER_METHODS,
    "githubSettingsWriter"
  );
}

module.exports = {
  AWS_MAINTENANCE_READER_METHODS,
  GITHUB_SETTINGS_WRITER_METHODS,
  assertAwsMaintenanceReader,
  assertGitHubSettingsWriter,
};
