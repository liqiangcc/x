"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const BIN = path.join(ROOT, "bin", "x");

async function readEntry() {
  return fs.readFile(BIN, "utf8");
}

test("bin/x does not retain retired proxy-pool parsing helpers", async () => {
  const source = await readEntry();

  assert.doesNotMatch(source, /function parseDurationMs\(/);
  assert.doesNotMatch(source, /function parsePositiveOption\(/);

  // Similar helpers used by daily/kline are still live and must not be removed by this cleanup.
  assert.match(source, /function parsePositiveIntegerOption\(/);
  assert.match(source, /function parseNonNegativeIntegerOption\(/);
});

test("bin/x proxy-pool family stays a delegation-only router", async () => {
  const source = await readEntry();
  const start = source.indexOf("async function commandProxyPool(argv) {");
  const end = source.indexOf("function printDailyRunSummary", start);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const router = source.slice(start, end);
  const delegatedCommands = [
    "commandProxyPoolVerify",
    "commandProxyPoolSelect",
    "commandProxyPoolStatus",
    "commandProxyPoolRefreshGithub",
    "commandProxyPoolLifecycle",
    "commandProxyPoolDiagnose",
    "commandProxyPoolProbe",
    "commandProxyPoolBenchmark",
    "commandProxyPoolWarmup",
  ];

  for (const command of delegatedCommands) {
    assert.match(router, new RegExp(command));
  }

  assert.doesNotMatch(router, /parseOptions\(/);
  assert.doesNotMatch(router, /runProxyBenchmark/);
  assert.doesNotMatch(router, /ProxyBatchRuntime/);
  assert.doesNotMatch(router, /proxyBenchmarkReportWriter\.write/);
});
