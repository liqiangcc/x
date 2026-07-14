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

test("ProxyManager waits for a healthy proxy leased by another request", async () => {
  const leased = new Set();
  const manager = new ProxyManager({
    classifyError: () => "network_error",
    healthStore: {
      read: async () => ({ version: 2, proxies: {} }),
      record: async () => {},
    },
    provider: { listCandidates: async () => ["1.1.1.1:80"] },
    transport: async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { body: "ok", durationMs: 20, statusCode: 200 };
    },
  });
  const options = {
    acquire(proxy) {
      if (leased.has(proxy.id)) return false;
      leased.add(proxy.id);
      return true;
    },
    leasePollMs: 1,
    leaseWaitMs: 100,
    probe: { target: "service-a", request: { url: "https://example.test" }, validate: (response) => response.body },
    random: () => 1,
    release: (proxy) => leased.delete(proxy.id),
  };
  const [first, second] = await Promise.all([manager.execute(options), manager.execute(options)]);
  assert.equal(first.payload, "ok");
  assert.equal(second.payload, "ok");
});

test("ProxyManager waits for a runtime proxy's short cooldown to expire", async () => {
  const proxy = require("../src/proxy/model").normalizeProxy("1.1.1.1:80");
  const cooldownUntil = new Date(Date.now() + 10).toISOString();
  const manager = new ProxyManager({
    classifyError: () => "network_error",
    healthStore: {
      read: async () => ({
        version: 2,
        proxies: {
          [proxy.id]: {
            proxy,
            targets: { "service-a": { cooldown_until: cooldownUntil } },
          },
        },
      }),
      record: async () => {},
    },
    provider: { listCandidates: async () => [proxy] },
    transport: async () => ({ body: "ok", durationMs: 1, statusCode: 200 }),
  });
  const result = await manager.execute({
    acquire: () => true,
    leasePollMs: 2,
    leaseWaitMs: 100,
    probe: { target: "service-a", request: { url: "https://example.test" }, validate: (response) => response.body },
    release: () => {},
  });
  assert.equal(result.payload, "ok");
});
