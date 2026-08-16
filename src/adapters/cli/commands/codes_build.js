"use strict";

const { parseCliOptions } = require("../option_parser");

function buildCodesBuildArgs(options) {
  const inputPath = options._[0];
  if (!inputPath) {
    throw new Error("codes build requires <pool_dir>");
  }

  const args = [inputPath, "--codes-only"];
  if (options.output) {
    args.push("--output", options.output);
  }
  return args;
}

function requireNodeScriptRunner(value) {
  if (typeof value !== "function") {
    throw new TypeError("codes build node script runner must be a function.");
  }
  return value;
}

async function runCodesBuildCommand({
  argv = [],
  nodeScriptRunner,
  createNodeScriptRunner,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const options = parseCliOptions(argv);
  const args = buildCodesBuildArgs(options);
  const runNodeScript = requireNodeScriptRunner(
    nodeScriptRunner ?? createNodeScriptRunner?.(),
  );
  const result = await runNodeScript("utils/parse_pool_json.js", args);
  stdout.write(result?.stdout ?? "");
  stderr.write(result?.stderr ?? "");
  return { args, result };
}

function createCodesBuildCommand({
  root,
  nodeScriptRunner,
  createNodeScriptRunner,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  let defaultRunner = null;
  function resolveNodeScriptRunner() {
    if (nodeScriptRunner) return nodeScriptRunner;
    if (createNodeScriptRunner) return createNodeScriptRunner({ root });
    const {
      createNodeScriptRunner: createDefaultNodeScriptRunner,
    } = require("../../system/node_script_runner");
    defaultRunner ??= createDefaultNodeScriptRunner({ root });
    return defaultRunner;
  }

  return (argv = []) => runCodesBuildCommand({
    argv,
    createNodeScriptRunner: resolveNodeScriptRunner,
    stdout,
    stderr,
  });
}

module.exports = {
  buildCodesBuildArgs,
  createCodesBuildCommand,
  runCodesBuildCommand,
};
