"use strict";

const { normalizeNodeScriptFailure } = require("../system/node_script_runner");
const { appendKlineSyncOptions } = require("./kline_sync_script_args");

const normalizeFailure = normalizeNodeScriptFailure;

function createKlineSyncRetryRunner({ nodeScriptRunner } = {}) {
  if (typeof nodeScriptRunner !== "function") {
    throw new TypeError("kline sync retry node script runner must be a function.");
  }

  return async function runKlineSync({
    engine,
    inputPath,
    options = {},
    outputDir,
    period,
  } = {}) {
    const args = [
      inputPath,
      "--period",
      period,
      "--engine",
      engine,
      "--output-dir",
      outputDir,
    ];
    appendKlineSyncOptions(args, options, { includeOutputDir: false });

    try {
      const result = await nodeScriptRunner("fetch/query_pool_klines.js", args);
      return {
        args,
        exitCode: 0,
        stderr: result?.stderr ?? "",
        stdout: result?.stdout ?? "",
      };
    } catch (error) {
      return {
        args,
        ...normalizeFailure(error),
      };
    }
  };
}

module.exports = {
  createKlineSyncRetryRunner,
  normalizeFailure,
};
