"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createProxyPoolProbeSessionFactory,
} = require("../src/adapters/proxy/proxy_pool_probe_session");

test("proxy probe session reuses one runtime across samples and maps runtime options", async () => {
  const calls = [];
  let runtimeCreations = 0;
  const factory = createProxyPoolProbeSessionFactory({
    runtimeFactory() {
      runtimeCreations += 1;
      return {
        async prepare(options) {
          calls.push(["prepare", options]);
          return { available_count: 1, start_index: options.startIndex };
        },
        async close() {
          calls.push(["close"]);
        },
      };
    },
  });

  const session = factory.open();
  const first = await session.sample({ concurrency: 2, samples: 20, startIndex: 0, timeoutMs: 5000 });
  const second = await session.sample({ concurrency: 2, samples: 20, startIndex: 20, timeoutMs: 5000 });
  await session.close();

  assert.equal(runtimeCreations, 1);
  assert.deepEqual(first, { available_count: 1, start_index: 0 });
  assert.deepEqual(second, { available_count: 1, start_index: 20 });
  assert.deepEqual(calls, [
    ["prepare", {
      concurrency: 2,
      limit: 20,
      minAvailable: 0,
      minSuccessRate: 0,
      startIndex: 0,
      timeoutMs: 5000,
    }],
    ["prepare", {
      concurrency: 2,
      limit: 20,
      minAvailable: 0,
      minSuccessRate: 0,
      startIndex: 20,
      timeoutMs: 5000,
    }],
    ["close"],
  ]);
});
