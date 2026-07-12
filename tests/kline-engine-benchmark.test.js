"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { normalizeOptions, runEngineBenchmark, withDeadline } = require("../src/kline/engine_benchmark");

test("engine benchmark validates engine names and numeric options", () => {
  assert.deepEqual(normalizeOptions({ engines: "local,aws", attempts: "2", lmt: "20" }).engines, ["local", "aws"]);
  assert.throws(() => normalizeOptions({ engines: "unknown" }), /Invalid Kline benchmark engine/);
  assert.throws(() => normalizeOptions({ period: "weekly" }), /daily or yearly/);
  assert.throws(() => normalizeOptions({ proxyMaxAttempts: "0" }), /positive integer/);
});

test("engine benchmark records success latency and unavailable engines", async () => {
  const report = await runEngineBenchmark({ engines: "local,aws", attempts: 2, timeoutMs: 100 }, {
    fetchEngine: async (engine) => {
      if (engine === "aws") throw new Error("AWS credentials required");
      return { source_engine: "local", data: { klines: ["row"] } };
    },
  });
  assert.equal(report.summary.local.success, 2);
  assert.equal(report.summary.local.success_rate, 1);
  assert.equal(report.summary.aws.failed, 2);
  assert.equal(report.summary.aws.error_counts.unconfigured, 2);
  assert.equal(report.results[0].points, 1);
});

test("engine benchmark deadline bounds hanging engines", async () => {
  await assert.rejects(() => withDeadline(() => new Promise(() => {}), 20), /deadline exceeded/);
});
