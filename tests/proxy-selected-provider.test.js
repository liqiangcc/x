"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { ProxyPoolProvider } = require("../src/proxy/providers/proxypool");

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
