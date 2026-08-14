"use strict";

const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

function createExecToolProbe({ cwd } = {}) {
  return async function runTool({ name, args = [] } = {}) {
    if (!name) throw new TypeError("tool name is required.");
    return execFileAsync(name, args, { cwd });
  };
}

module.exports = {
  createExecToolProbe,
};
