"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  createFilesystemProxyHealthStateReader,
} = require("../src/adapters/proxy/filesystem_proxy_health_state_reader");
const {
  createFilesystemProxySelectionReportStore,
} = require("../src/adapters/proxy/filesystem_proxy_selection_report_store");

test("filesystem proxy health reader uses the historical default state path", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "proxy-select-health-"));
  const stateFile = path.join(root, "var/proxy-pool/ttjj-health.json");
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  await fs.writeFile(stateFile, JSON.stringify({ version: 2, proxies: { a: { proxy: { endpoint: "1.1.1.1:80" }, targets: {} } } }));

  const reader = createFilesystemProxyHealthStateReader({ root });
  const state = await reader.read();
  assert.equal(state.version, 2);
  assert.equal(state.proxies.a.proxy.endpoint, "1.1.1.1:80");
});

test("filesystem proxy health reader preserves missing-state fallback", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "proxy-select-health-missing-"));
  const reader = createFilesystemProxyHealthStateReader({ root });
  assert.deepEqual(await reader.read(), { version: 2, proxies: {} });
});

test("filesystem proxy selection store preserves historical JSON shape and default output", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "proxy-select-store-"));
  const store = createFilesystemProxySelectionReportStore({ root });
  const report = {
    generated_at: "2026-08-15T00:00:00Z",
    target: "eastmoney-kline",
    policy: { min_samples: 5 },
    selected_count: 1,
    retained_previous: false,
    proxies: [{ endpoint: "1.1.1.1:80" }],
  };

  const stored = await store.write({ report });
  assert.deepEqual(stored, { output: "var/proxy-pool/selected.json" });
  const text = await fs.readFile(path.join(root, stored.output), "utf8");
  assert.equal(text, `${JSON.stringify(report, null, 2)}\n`);
  assert.equal(Object.hasOwn(JSON.parse(text), "output"), false);

  const previous = await store.readPrevious();
  assert.deepEqual(previous, { report, output: "var/proxy-pool/selected.json" });
});

test("filesystem proxy selection store resolves custom output and returns null when missing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "proxy-select-custom-"));
  const store = createFilesystemProxySelectionReportStore({ root });
  assert.equal(await store.readPrevious({ output: "custom/selected.json" }), null);

  await store.write({ output: "custom/selected.json", report: { proxies: [] } });
  assert.deepEqual(await store.readPrevious({ output: "custom/selected.json" }), {
    report: { proxies: [] },
    output: "custom/selected.json",
  });
});
