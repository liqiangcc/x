"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { ProxyManager } = require("../src/proxy/manager");

test("ProxyManager composes provider, selector, transport, probe, and target health", async () => {
  const records = [];
  const manager = new ProxyManager({
    classifyError: () => "network_error",
    healthStore: {
      read: async () => ({ version: 2, proxies: {} }),
      record: async (...args) => records.push(args),
    },
    provider: { listCandidates: async () => ["1.1.1.1:80"] },
    transport: async () => ({ body: "ok", durationMs: 12, statusCode: 200 }),
  });
  const result = await manager.execute({
    probe: { target: "service-a", request: { url: "https://example.test" }, validate: (response) => response.body },
    random: () => 1,
  });
  assert.equal(result.payload, "ok");
  assert.equal(result.proxy.endpoint, "1.1.1.1:80");
  assert.equal(records[0][1], "service-a");
});
