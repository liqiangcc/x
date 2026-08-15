"use strict";

const path = require("node:path");
const { readHealthState } = require("../../proxy/health/store");

function createFilesystemProxyHealthStateReader({ root, stateFile } = {}) {
  const resolvedRoot = root ?? process.cwd();
  const resolvedStateFile = stateFile ?? path.join(resolvedRoot, "var/proxy-pool/ttjj-health.json");
  return {
    read() {
      return readHealthState(resolvedStateFile);
    },
  };
}

module.exports = {
  createFilesystemProxyHealthStateReader,
};
