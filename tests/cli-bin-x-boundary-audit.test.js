"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const BIN = path.join(ROOT, "bin", "x");
const PROXY_POOL_ROUTER = path.join(ROOT, "src", "adapters", "cli", "commands", "proxy_pool.js");

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

test("proxy-pool family stays a delegation-only CLI router", async () => {
  const source = await readEntry();
  const router = await fs.readFile(PROXY_POOL_ROUTER, "utf8");
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

  assert.match(source, /createProxyPoolCommand/);
  assert.match(source, /const commandProxyPool = createProxyPoolCommand\(\{/);
  assert.doesNotMatch(source, /async function commandProxyPool\(argv\)/);

  for (const command of delegatedCommands) {
    assert.match(source, new RegExp(command));
  }

  assert.doesNotMatch(router, /parseOptions\(/);
  assert.doesNotMatch(router, /runProxyBenchmark/);
  assert.doesNotMatch(router, /ProxyBatchRuntime/);
  assert.doesNotMatch(router, /proxyBenchmarkReportWriter\.write/);
});
