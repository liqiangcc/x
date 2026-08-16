"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createProxyPoolBenchmarkRunner,
} = require("../src/adapters/proxy/proxy_pool_benchmark_runner");

test("proxy benchmark runner delegates exact benchmark options", async () => {
  const calls = [];
  const runner = createProxyPoolBenchmarkRunner({
    async runBenchmark(options) {
      calls.push(options);
      return { samples: options.samples, concurrency: options.concurrency, passed: true };
    },
  });

  const report = await runner.run({ samples: 40, concurrency: 8 });

  assert.deepEqual(calls, [{ samples: 40, concurrency: 8 }]);
  assert.deepEqual(report, { samples: 40, concurrency: 8, passed: true });
});

test("proxy benchmark runner propagates existing capability failures unchanged", async () => {
  const failure = new Error("benchmark failed");
  const runner = createProxyPoolBenchmarkRunner({
    async runBenchmark() {
      throw failure;
    },
  });

  await assert.rejects(() => runner.run({ samples: 1, concurrency: 1 }), (error) => error === failure);
});
