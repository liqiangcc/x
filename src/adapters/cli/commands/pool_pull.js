"use strict";

const { parseCliOptions } = require("../option_parser");

function normalizePoolPullDate(input) {
  const digits = String(input).replace(/-/g, "");
  if (!/^\d{8}$/.test(digits)) {
    throw new Error(`Invalid date: ${input}`);
  }
  return digits;
}

function buildPoolPullArgs(options) {
  const args = [];

  if (options.date) {
    args.push(normalizePoolPullDate(options.date));
  } else if (options._[0]) {
    args.push(normalizePoolPullDate(options._[0]));
  } else if (options.latest) {
    args.push("--days", "0");
  }

  if (options.rangeDays) {
    args.push("--range-days", String(options.rangeDays));
  }
  if (options.engine) {
    args.push("--engine", options.engine);
  }
  args.push("--output-dir", options.outputDir);
  return args;
}

function requireNodeScriptRunner(value) {
  if (typeof value !== "function") {
    throw new TypeError("pool pull node script runner must be a function.");
  }
  return value;
}

async function runPoolPullCommand({
  argv = [],
  nodeScriptRunner,
  createNodeScriptRunner,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const options = parseCliOptions(argv, {
    engine: "curl",
    outputDir: "data/pool",
  });
  const args = buildPoolPullArgs(options);
  const runNodeScript = requireNodeScriptRunner(
    nodeScriptRunner ?? createNodeScriptRunner?.(),
  );
  const result = await runNodeScript("fetch/pull_pool_task.js", args);
  stdout.write(result?.stdout ?? "");
  stderr.write(result?.stderr ?? "");
  return {
    args,
    result,
  };
}

function createPoolPullCommand({
  root,
  nodeScriptRunner,
  createNodeScriptRunner,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  let defaultRunner = null;
  function resolveNodeScriptRunner() {
    if (nodeScriptRunner) {
      return nodeScriptRunner;
    }
    if (createNodeScriptRunner) {
      return createNodeScriptRunner({ root });
    }
    const {
      createNodeScriptRunner: createDefaultNodeScriptRunner,
    } = require("../../system/node_script_runner");
    defaultRunner ??= createDefaultNodeScriptRunner({ root });
    return defaultRunner;
  }

  return (argv = []) => runPoolPullCommand({
    argv,
    createNodeScriptRunner: resolveNodeScriptRunner,
    stdout,
    stderr,
  });
}

module.exports = {
  buildPoolPullArgs,
  createPoolPullCommand,
  normalizePoolPullDate,
  runPoolPullCommand,
};
