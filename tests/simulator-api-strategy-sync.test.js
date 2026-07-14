"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildServer } = require("../src/simulator/adapters/http/server");

test("strategy sync API starts jobs and exposes orchestration state", async (context) => {
  const calls = [];
  const runtime = {
    listStrategySyncs: () => ({ jobs: [{ id: "job-a", status: "running" }] }),
    getStrategySync: (strategyId) => ({ job: { strategyId, status: "running" } }),
    startStrategySync: (strategyId) => {
      calls.push(strategyId);
      return { job: { id: "job-a", strategyId, status: "queued" } };
    },
  };
  const app = buildServer({ runtime });
  context.after(() => app.close());

  const started = await app.inject({ method: "POST", url: "/api/strategies/strategy-a/sync" });
  const latest = await app.inject({ method: "GET", url: "/api/strategies/strategy-a/sync" });
  const listed = await app.inject({ method: "GET", url: "/api/strategy-syncs" });

  assert.equal(started.statusCode, 202);
  assert.equal(latest.json().job.strategyId, "strategy-a");
  assert.equal(listed.json().jobs.length, 1);
  assert.deepEqual(calls, ["strategy-a"]);
});
