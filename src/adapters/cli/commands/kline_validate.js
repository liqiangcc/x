"use strict";

const { parseCliOptions } = require("../option_parser");
const { runNodeScriptAllowFailure } = require("../../system/node_script_runner");

function buildKlineValidateArgs(options = {}) {
  const args = [options._?.[0] ?? "data/kline"];
  if (options.period) args.push("--period", options.period);
  if (options.json) args.push("--json");
  return args;
}

function requireNodeScriptRunner(value) {
  if (typeof value !== "function") {
    throw new TypeError("kline validate node script runner must be a function.");
  }
  return value;
}

async function runKlineValidateCommand({
  argv = [],
  nodeScriptRunner,
  createNodeScriptRunner,
  stdout = process.stdout,
  stderr = process.stderr,
  setExitCode = (exitCode) => {
    process.exitCode = exitCode;
  },
} = {}) {
  const options = parseCliOptions(argv);
  const args = buildKlineValidateArgs(options);
  const runNodeScript = requireNodeScriptRunner(
    nodeScriptRunner ?? createNodeScriptRunner?.(),
  );
  const result = await runNodeScriptAllowFailure(
    runNodeScript,
    "fetch/check_kline_empty.js",
    args,
  );

  stdout.write(result.stdout);
  stderr.write(result.stderr);
  if (result.exitCode !== 0) setExitCode(result.exitCode);
  return { args, result };
}

function createKlineValidateCommand({
  root,
  nodeScriptRunner,
  createNodeScriptRunner,
  stdout = process.stdout,
  stderr = process.stderr,
  setExitCode = (exitCode) => {
    process.exitCode = exitCode;
  },
} = {}) {
  let defaultRunner;
  function resolveNodeScriptRunner() {
    if (nodeScriptRunner) return nodeScriptRunner;
    if (createNodeScriptRunner) return createNodeScriptRunner({ root });
    const { createNodeScriptRunner: createDefaultNodeScriptRunner } = require("../../system/node_script_runner");
    defaultRunner ??= createDefaultNodeScriptRunner({ root });
    return defaultRunner;
  }

  return (argv = []) => runKlineValidateCommand({
    argv,
    createNodeScriptRunner: resolveNodeScriptRunner,
    stdout,
    stderr,
    setExitCode,
  });
}

module.exports = {
  buildKlineValidateArgs,
  createKlineValidateCommand,
  runKlineValidateCommand,
};
