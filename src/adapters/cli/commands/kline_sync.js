"use strict";

const { parseCliOptions } = require("../option_parser");

function appendKlineSyncOptions(args, options, { includeOutputDir = true } = {}) {
  if (options.policy) args.push("--policy", options.policy);
  if (options.refreshMode) args.push("--refresh-mode", options.refreshMode);
  if (options.checkpointEvery) args.push("--checkpoint-every", String(options.checkpointEvery));
  if (options.proxyPreflight) args.push("--proxy-preflight");
  if (options.noProxyPreflight) args.push("--no-proxy-preflight");
  if (options.proxyMinAvailable) args.push("--proxy-min-available", String(options.proxyMinAvailable));
  if (options.proxyMinSuccessRate) args.push("--proxy-min-success-rate", String(options.proxyMinSuccessRate));
  if (options.proxyMaxP95Ms) args.push("--proxy-max-p95-ms", String(options.proxyMaxP95Ms));
  if (options.proxyPreflightConcurrency) args.push("--proxy-preflight-concurrency", String(options.proxyPreflightConcurrency));
  if (options.proxyPreflightTimeoutMs) args.push("--proxy-preflight-timeout-ms", String(options.proxyPreflightTimeoutMs));
  if (options.failureQueue) args.push("--failure-queue", options.failureQueue);
  if (options.limit) args.push("--limit", String(options.limit));
  if (options.batchSize) args.push("--batch-size", String(options.batchSize));
  if (options.offset) args.push("--offset", String(options.offset));
  if (includeOutputDir && options.outputDir) args.push("--output-dir", options.outputDir);
  if (options.force) args.push("--force");
  if (options.concurrency) args.push("--concurrency", String(options.concurrency));
  if (options.retryAttempts) args.push("--retry-attempts", String(options.retryAttempts));
  if (options.retryDelayMs) args.push("--retry-delay-ms", String(options.retryDelayMs));
  if (options.retryConcurrency) args.push("--retry-concurrency", String(options.retryConcurrency));
  if (options.awsRegion) args.push("--aws-region", options.awsRegion);
  if (options.routerRegion) args.push("--router-region", options.routerRegion);
  if (options.proxyPoolUrl) args.push("--proxy-pool-url", options.proxyPoolUrl);
  if (options.proxyMaxAttempts) args.push("--proxy-max-attempts", String(options.proxyMaxAttempts));
  if (options.huaweicloudRegion) args.push("--huaweicloud-region", options.huaweicloudRegion);
  if (options.huaweicloudRegionStartIndex) args.push("--huaweicloud-region-start-index", String(options.huaweicloudRegionStartIndex));
  if (options.huaweicloudTargets) args.push("--huaweicloud-targets", options.huaweicloudTargets);
  if (options.lambdaName) args.push("--lambda-name", options.lambdaName);
  if (options.config) args.push("--config", options.config);
  if (options.minSuccessRate) args.push("--min-success-rate", String(options.minSuccessRate));
  if (options.expectedLatestDate) args.push("--expected-latest-date", String(options.expectedLatestDate));
  if (options.freshnessCodes) args.push("--freshness-codes", String(options.freshnessCodes));
  return args;
}

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
