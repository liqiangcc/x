"use strict";

const { appendKlineSyncOptions } = require("../../kline/kline_sync_script_args");
const { parseCliOptions } = require("../option_parser");

function buildKlineSyncArgs(options) {
  const inputPath = options._[0];
  if (!inputPath) throw new Error("kline sync requires <input_dir|codes.json>");
  if (options.policy && options.engine) throw new Error("--policy and --engine cannot be used together.");
  const args = [inputPath, "--period", options.period];
  if (options.engine) args.push("--engine", options.engine);
  return appendKlineSyncOptions(args, options);
}

async function runKlineSyncCommand({ argv = [], nodeScriptRunner, createNodeScriptRunner, stdout = process.stdout, stderr = process.stderr } = {}) {
  const options = parseCliOptions(argv, { period: "daily" });
  const args = buildKlineSyncArgs(options);
  const runner = nodeScriptRunner ?? createNodeScriptRunner?.();
  if (typeof runner !== "function") throw new TypeError("kline sync node script runner must be a function.");
  const result = await runner("fetch/query_pool_klines.js", args);
  stdout.write(result?.stdout ?? "");
  stderr.write(result?.stderr ?? "");
  return { args, result };
}

function createKlineSyncCommand({ root, nodeScriptRunner, createNodeScriptRunner, stdout = process.stdout, stderr = process.stderr } = {}) {
  let defaultRunner;
  const resolveRunner = () => {
    if (nodeScriptRunner) return nodeScriptRunner;
    if (createNodeScriptRunner) return createNodeScriptRunner({ root });
    const { createNodeScriptRunner: createDefault } = require("../../system/node_script_runner");
    defaultRunner ??= createDefault({ root });
    return defaultRunner;
  };
  return (argv = []) => runKlineSyncCommand({ argv, createNodeScriptRunner: resolveRunner, stdout, stderr });
}

module.exports = { appendKlineSyncOptions, buildKlineSyncArgs, createKlineSyncCommand, runKlineSyncCommand };
