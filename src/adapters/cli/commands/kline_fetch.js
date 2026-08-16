"use strict";

const { parseCliOptions } = require("../option_parser");

function buildKlineFetchArgs(options = {}) {
  const input = options._?.[0];
  if (!input) {
    throw new Error("kline fetch requires <code_or_secid>");
  }
  if (options.policy && options.engine) {
    throw new Error("--policy and --engine cannot be used together.");
  }

  const args = [input, "--period", options.period ?? "daily"];
  if (options.policy) args.push("--policy", options.policy);
  else if (options.engine) args.push("--engine", options.engine);
  if (options.awsRegion) args.push("--aws-region", options.awsRegion);
  if (options.routerRegion) args.push("--router-region", options.routerRegion);
  if (options.proxyPoolUrl) args.push("--proxy-pool-url", options.proxyPoolUrl);
  if (options.proxyMaxAttempts) args.push("--proxy-max-attempts", String(options.proxyMaxAttempts));
  if (options.huaweicloudRegion) args.push("--huaweicloud-region", options.huaweicloudRegion);
  if (options.huaweicloudRegionStartIndex) {
    args.push("--huaweicloud-region-start-index", String(options.huaweicloudRegionStartIndex));
  }
  if (options.huaweicloudTargets) args.push("--huaweicloud-targets", options.huaweicloudTargets);
  if (options.lambdaName) args.push("--lambda-name", options.lambdaName);
  if (options.config) args.push("--config", options.config);
  if (options.output) args.push("--output", options.output);
  return args;
}

function requireNodeScriptRunner(value) {
  if (typeof value !== "function") {
    throw new TypeError("kline fetch node script runner must be a function.");
  }
  return value;
}

async function runKlineFetchCommand({
  argv = [],
  nodeScriptRunner,
  createNodeScriptRunner,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const options = parseCliOptions(argv, { period: "daily" });
  const args = buildKlineFetchArgs(options);
  const runNodeScript = requireNodeScriptRunner(
    nodeScriptRunner ?? createNodeScriptRunner?.(),
  );
  const result = await runNodeScript("fetch/fetch_kline.js", args);
  stdout.write(result?.stdout ?? "");
  stderr.write(result?.stderr ?? "");
  return { args, result };
}

function createKlineFetchCommand({
  root,
  nodeScriptRunner,
  createNodeScriptRunner,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  let defaultRunner;
  function resolveNodeScriptRunner() {
    if (nodeScriptRunner) return nodeScriptRunner;
    if (createNodeScriptRunner) return createNodeScriptRunner({ root });
    const { createNodeScriptRunner: createDefaultNodeScriptRunner } = require("../../system/node_script_runner");
    defaultRunner ??= createDefaultNodeScriptRunner({ root });
    return defaultRunner;
  }

  return (argv = []) => runKlineFetchCommand({
    argv,
    createNodeScriptRunner: resolveNodeScriptRunner,
    stdout,
    stderr,
  });
}

module.exports = {
  buildKlineFetchArgs,
  createKlineFetchCommand,
  runKlineFetchCommand,
};
