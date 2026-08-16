"use strict";

const { parseCliOptions } = require("../option_parser");

function normalizeStocksFetchDate(input) {
  const digits = String(input).replace(/-/g, "");
  if (!/^\d{8}$/.test(digits)) {
    throw new Error(`Invalid date: ${input}`);
  }
  return digits;
}

function buildStocksFetchArgs(options) {
  const args = ["--market", options.market, "--output-dir", options.outputDir];

  if (options.date && options.latest) {
    throw new Error("--date and --latest cannot be used together.");
  }
  if (options.date) {
    args.push("--date", normalizeStocksFetchDate(options.date));
  } else {
    args.push("--latest");
  }
  if (options.pageSize) {
    args.push("--page-size", String(options.pageSize));
  }
  return args;
}

function requireNodeScriptRunner(value) {
  if (typeof value !== "function") {
    throw new TypeError("stocks fetch node script runner must be a function.");
  }
  return value;
}

async function runStocksCommand({
  argv = [],
  nodeScriptRunner,
  createNodeScriptRunner,
  defaultOutputDir = "data/universe",
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const subcommand = argv[0];
  if (subcommand !== "fetch") {
    throw new Error(`Unknown stocks command: ${subcommand ?? ""}`);
  }

  const options = parseCliOptions(argv.slice(1), {
    market: "hs-a",
    outputDir: defaultOutputDir,
  });
  const args = buildStocksFetchArgs(options);
  const runNodeScript = requireNodeScriptRunner(
    nodeScriptRunner ?? createNodeScriptRunner?.(),
  );
  const result = await runNodeScript("fetch/fetch_market_stocks.js", args);
  stdout.write(result?.stdout ?? "");
  stderr.write(result?.stderr ?? "");
  return { args, result };
}

function createStocksCommand({
  root,
  outputDir = "data/universe",
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

  return (argv = []) => runStocksCommand({
    argv,
    createNodeScriptRunner: resolveNodeScriptRunner,
    defaultOutputDir: outputDir,
    stdout,
    stderr,
  });
}

module.exports = {
  buildStocksFetchArgs,
  createStocksCommand,
  normalizeStocksFetchDate,
  runStocksCommand,
};
