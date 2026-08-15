"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  SelectProxyPoolUseCase,
} = require("../src/application/proxy/select_proxy_pool");

function stateWithEligibleProxy() {
  return {
    version: 2,
    proxies: {
      a: {
        proxy: { endpoint: "1.1.1.1:80", protocol: "http", region: "CN" },
        targets: {
          "eastmoney-kline": {
            sample_count: 10,
            success_rate: 1,
            p50_latency_ms: 100,
            p95_latency_ms: 200,
            ewma_latency_ms: 120,
            last_success_at: "2026-08-14T00:00:00Z",
          },
        },
      },
    },
  };
}

test("proxy selection use case reads health, applies pure policy, then persists report", async () => {
  const calls = [];
  let persisted;
  const useCase = new SelectProxyPoolUseCase({
    healthStateReader: {
      async read() {
        calls.push("read-health");
        return stateWithEligibleProxy();
      },
    },
    reportStore: {
      async readPrevious() {
        calls.push("read-previous");
        return null;
      },
      async write(value) {
        calls.push("write");
        persisted = value;
        return { output: "var/proxy-pool/selected.json" };
      },
    },
    now: () => "2026-08-15T00:00:00Z",
  });

  const report = await useCase.execute({
    limit: 5,
    maxP95Ms: 3000,
    minSamples: 5,
    minSuccessRate: 0.8,
  });

  assert.deepEqual(calls, ["read-health", "write"]);
  assert.equal(persisted.report.generated_at, "2026-08-15T00:00:00Z");
  assert.equal(Object.hasOwn(persisted.report, "output"), false);
  assert.equal(report.selected_count, 1);
  assert.equal(report.retained_previous, false);
  assert.equal(report.output, "var/proxy-pool/selected.json");
});

test("proxy selection use case retains previous report without rewriting when no proxy qualifies", async () => {
  let writes = 0;
  const previous = {
    generated_at: "2026-08-14T00:00:00Z",
    target: "eastmoney-kline",
    policy: { min_samples: 5 },
    selected_count: 1,
    retained_previous: false,
    proxies: [{ endpoint: "9.9.9.9:80" }],
  };
  const useCase = new SelectProxyPoolUseCase({
    healthStateReader: { async read() { return { version: 2, proxies: {} }; } },
    reportStore: {
      async readPrevious() {
        return { report: previous, output: "custom/selected.json" };
      },
      async write() { writes += 1; },
    },
  });

  const report = await useCase.execute({ output: "custom/selected.json" });
  assert.equal(writes, 0);
  assert.deepEqual(report, {
    ...previous,
    retained_previous: true,
    selected_count: 1,
    output: "custom/selected.json",
  });
});

test("proxy selection use case writes an empty report when no previous selection exists", async () => {
  let written;
  const useCase = new SelectProxyPoolUseCase({
    healthStateReader: { async read() { return { version: 2, proxies: {} }; } },
    reportStore: {
      async readPrevious() { return null; },
      async write(value) {
        written = value.report;
        return { output: "var/proxy-pool/selected.json" };
      },
    },
    now: () => "2026-08-15T01:00:00Z",
  });

  const report = await useCase.execute();
  assert.equal(written.selected_count, 0);
  assert.deepEqual(written.proxies, []);
  assert.equal(report.output, "var/proxy-pool/selected.json");
});

test("proxy selection use case requires both narrow persistence capabilities", () => {
  assert.throws(
    () => new SelectProxyPoolUseCase({ reportStore: { readPrevious() {}, write() {} } }),
    /ProxyHealthStateReader must expose read\(\)/
  );
  assert.throws(
    () => new SelectProxyPoolUseCase({ healthStateReader: { read() {} } }),
    /ProxySelectionReportStore must expose readPrevious\(\)/
  );
});
