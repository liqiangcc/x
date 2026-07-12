"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { ProxyPoolProvider } = require("../src/proxy/providers/proxypool");
const { rankCandidates } = require("../src/proxy/selectors");

test("selected-only provider reads only endpoints from the core list", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "proxy-provider-"));
  const file = path.join(dir, "selected.json");
  await fs.writeFile(file, JSON.stringify({ generated_at: new Date().toISOString(), proxies: [
    { endpoint: "1.1.1.1:80" }, { endpoint: "2.2.2.2:8080" },
  ] }));
  const rows = await new ProxyPoolProvider({ selectedOnly: true, selectedFile: file }).listCandidates();
  assert.deepEqual(rows.map((row) => row.endpoint), ["1.1.1.1:80", "2.2.2.2:8080"]);
  assert.ok(rows.every((row) => row.source === "selected"));
});

test("selected-only provider rejects stale lists without querying upstream", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "proxy-provider-"));
  const file = path.join(dir, "selected.json");
  await fs.writeFile(file, JSON.stringify({ generated_at: "2020-01-01T00:00:00Z", proxies: [{ endpoint: "1.1.1.1:80" }] }));
  await assert.rejects(() => new ProxyPoolProvider({ selectedOnly: true, selectedFile: file, selectedMaxAgeMs: 1000 }).listCandidates(), /stale/);
});

test("selected core candidates bypass generic pool cooldowns", () => {
  const proxy = { id: "a", endpoint: "1.1.1.1:80" };
  const state = { proxies: { a: { targets: { "eastmoney-kline": {
    cooldown_until: "2099-01-01T00:00:00Z", sample_count: 10, success_rate: 1,
    p95_latency_ms: 100, last_success_at: new Date().toISOString(),
  } } } } };
  assert.equal(rankCandidates([proxy], state, { strategy: "reliable-fastest", target: "eastmoney-kline" }).length, 0);
  assert.equal(rankCandidates([proxy], state, {
    strategy: "reliable-fastest", target: "eastmoney-kline", ignoreCooldown: true,
  }).length, 1);
});
