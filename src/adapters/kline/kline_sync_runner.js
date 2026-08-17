"use strict";

const { appendKlineSyncOptions } = require("./kline_sync_script_args");

function buildKlineSyncRunArgs({ engine, inputPath, options = {}, period } = {}) {
  if (!inputPath) {
    throw new TypeError("kline sync runner inputPath is required.");
  }
  if (!period) {
    throw new Error("Missing value for --period");
  }

  const args = [inputPath, "--period", period];
  if (engine) args.push("--engine", engine);
  return appendKlineSyncOptions(args, options);
}

function createKlineSyncRunner({ nodeScriptRunner } = {}) {
  if (typeof nodeScriptRunner !== "function") {
    throw new TypeError("kline sync node script runner must be a function.");
  }

  return async function runKlineSync(request = {}) {
    const args = buildKlineSyncRunArgs(request);
    const result = await nodeScriptRunner("fetch/query_pool_klines.js", args);
    return {
      args,
      stderr: result?.stderr ?? "",
      stdout: result?.stdout ?? "",
    };
  };
}

module.exports = {
  buildKlineSyncRunArgs,
  createKlineSyncRunner,
};
