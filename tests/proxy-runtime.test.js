"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { ProxyBatchRuntime } = require("../src/proxy/runtime");

test("batch runtime preflights once and exposes the reusable available set", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "proxy-runtime-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let destroyed = 0;
  const runtime = new ProxyBatchRuntime({
    classifyError: () => "network_error",
    cooldownForError: () => 1000,
    fetchImpl: async (url) => new Response(String(url).includes("/all") ? "1.1.1.1:80\n2.2.2.2:80" : "2", { status: 200 }),
    proxyAgentFactory: () => ({ destroy: async () => { destroyed += 1; } }),
    requestImpl: async () => ({ statusCode: 200, body: { text: async () => JSON.stringify({ data: { klines: ["2026-07-10,1,1,1,1,1,1,0,0,0,0"] } }) } }),
    stateFile: path.join(dir, "health.json"),
  });
  const report = await runtime.prepare({ concurrency: 2, minAvailable: 2, minSuccessRate: 1 });
  assert.equal(report.available_count, 2);
  assert.equal(runtime.listCandidates().length, 2);
  assert.equal(report.sources[0].available_count, 2);
  await runtime.close();
  assert.equal(destroyed, 2);
});
