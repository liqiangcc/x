"use strict";

const path = require("node:path");
const { parseCliOptions } = require("../option_parser");

function rootPath(root, filePath) {
  return path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
}

function buildKlineRetryQueueRequest(options, { root } = {}) {
  const queuePath = options._[0];
  if (!queuePath) {
    throw new Error("kline retry-queue requires <queue.json>.");
  }
  if (!root) {
    throw new TypeError("kline retry-queue root is required.");
  }

  const queueFile = rootPath(root, queuePath);
  const dueFile = path.join(
    path.dirname(queueFile),
    `${path.basename(queueFile, ".json")}.due.json`,
  );
  return {
    concurrency: options.concurrency,
    dueFile,
    policy: options.policy,
    queueFile,
  };
}

function requireRetryKlineQueueUseCase(value) {
  if (!value || typeof value.execute !== "function") {
    throw new TypeError("kline retry-queue use case must expose execute().");
  }
  return value;
}

async function runKlineRetryQueueCommand({
  argv = [],
  root,
  useCase,
  createUseCase,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const options = parseCliOptions(argv, {
    concurrency: "2",
    policy: "proxy-only",
  });
  const request = buildKlineRetryQueueRequest(options, { root });
  const retryQueue = requireRetryKlineQueueUseCase(useCase ?? createUseCase?.());
  const result = await retryQueue.execute(request);

  if (result.status === "no_due_items") {
    stdout.write(`${JSON.stringify({
      status: "no_due_items",
      queue: result.queueFile,
      due: 0,
    }, null, 2)}\n`);
    return result;
  }

  stdout.write(result?.result?.stdout ?? "");
  stderr.write(result?.result?.stderr ?? "");
  return result;
}

function createKlineRetryQueueCommand({
  root,
  useCase,
  createUseCase,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  let defaultUseCase = null;

  function resolveUseCase() {
    if (useCase) return useCase;
    if (createUseCase) return createUseCase({ root });
    if (defaultUseCase) return defaultUseCase;

    const { RetryKlineQueueUseCase } = require("../../../application/kline/retry_kline_queue");
    const { createKlineSyncRunner } = require("../../kline/kline_sync_runner");
    const { createNodeScriptRunner } = require("../../system/node_script_runner");
    const { writeDueCodes } = require("../../../kline/failure_queue");

    defaultUseCase = new RetryKlineQueueUseCase({
      runKlineSync: createKlineSyncRunner({
        nodeScriptRunner: createNodeScriptRunner({ root }),
      }),
      writeDueCodes,
    });
    return defaultUseCase;
  }

  return (argv = []) => runKlineRetryQueueCommand({
    argv,
    createUseCase: resolveUseCase,
    root,
    stderr,
    stdout,
  });
}

module.exports = {
  buildKlineRetryQueueRequest,
  createKlineRetryQueueCommand,
  runKlineRetryQueueCommand,
};
