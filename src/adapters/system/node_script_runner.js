"use strict";

const { execFile } = require("node:child_process");
const path = require("node:path");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const DEFAULT_MAX_BUFFER = 50 * 1024 * 1024;

function normalizeNodeScriptFailure(error) {
  return {
    exitCode: typeof error?.code === "number" ? error.code : 1,
    stderr: error?.stderr ?? error?.message ?? String(error),
    stdout: error?.stdout ?? "",
  };
}

async function runNodeScriptAllowFailure(nodeScriptRunner, scriptPath, args = []) {
  if (typeof nodeScriptRunner !== "function") {
    throw new TypeError("node script runner must be a function.");
  }

  try {
    const result = await nodeScriptRunner(scriptPath, args);
    return {
      exitCode: 0,
      stderr: result?.stderr ?? "",
      stdout: result?.stdout ?? "",
    };
  } catch (error) {
    return normalizeNodeScriptFailure(error);
  }
}

function createNodeScriptRunner({
  root,
  executeFile = execFileAsync,
  nodeExecutable = "node",
  env = process.env,
  maxBuffer = DEFAULT_MAX_BUFFER,
} = {}) {
  if (!root) {
    throw new TypeError("node script runner root is required.");
  }
  if (typeof executeFile !== "function") {
    throw new TypeError("node script runner executeFile must be a function.");
  }

  return async function runNodeScript(scriptPath, args = []) {
    if (!scriptPath) {
      throw new TypeError("node script path is required.");
    }
    if (!Array.isArray(args)) {
      throw new TypeError("node script args must be an array.");
    }

    return executeFile(
      nodeExecutable,
      [path.join(root, scriptPath), ...args],
      {
        cwd: root,
        env,
        maxBuffer,
      },
    );
  };
}

module.exports = {
  DEFAULT_MAX_BUFFER,
  createNodeScriptRunner,
  normalizeNodeScriptFailure,
  runNodeScriptAllowFailure,
};
