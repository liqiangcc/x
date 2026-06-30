"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { listProxies, rotateProxy } = require("../src/proxy/clash");

async function withTempConfig(content, fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "x-proxy-test-"));
  const filePath = path.join(dir, "runtime.yaml");
  await fs.writeFile(filePath, content, "utf8");
  try {
    await fn(filePath);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("listProxies reads inline Clash proxy group entries", async () => {
  await withTempConfig("proxy-groups:\n  - {name: lx, type: select, proxies: [A,B,C]}\n", async (configFile) => {
    assert.deepEqual(await listProxies({ configFile, groupName: "lx" }), ["A", "B", "C"]);
  });
});

test("rotateProxy moves selected proxy to front", async () => {
  await withTempConfig("proxy-groups:\n  - {name: lx, type: select, proxies: [A,B,C]}\n", async (configFile) => {
    const result = await rotateProxy({ configFile, groupName: "lx", proxyName: "C" });
    const updated = await fs.readFile(configFile, "utf8");

    assert.equal(result.proxy, "C");
    assert.match(updated, /proxies: \[C,A,B\]/);
  });
});
