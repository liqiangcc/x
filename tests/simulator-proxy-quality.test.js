"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { ProxyQualityService } = require("../src/simulator/application/proxy_quality_service");

async function until(predicate) {
  for (let index = 0; index < 50; index += 1) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for proxy quality job.");
}

test("proxy quality refreshes GitHub before validating Eastmoney quality", async () => {
  const calls = [];
  const githubProviderFactory = () => ({ lastReport: { cache: "updated", repository: "owner/repo", sha: "abc" }, listCandidates: async () => { calls.push("github"); return [{ endpoint: "1.1.1.1:80" }]; } });
  const runtimeFactory = () => ({ close: async () => calls.push("close"), prepare: async () => { calls.push("verify"); return { candidate_count: 3, available_count: 3, success_rate: 1, p50_duration_ms: 100, p95_duration_ms: 200, sources: [] }; } });
  const service = new ProxyQualityService({ githubProviderFactory, runtimeFactory });
  assert.equal(service.start().status, "queued");
  const job = await until(() => service.status()?.status === "completed" && service.status());
  assert.deepEqual(calls, ["github", "verify", "close"]);
  assert.equal(job.quality.qualified, true);
  assert.equal(job.github.candidateCount, 1);
});

test("proxy quality prevents overlapping refresh jobs", async () => {
  let release;
  const service = new ProxyQualityService({ githubProviderFactory: () => ({ listCandidates: () => new Promise((resolve) => { release = resolve; }) }) });
  service.start();
  await until(() => release);
  assert.throws(() => service.start(), (error) => error.code === "proxy_quality_running" && error.statusCode === 409);
  release([]);
});
