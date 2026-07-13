"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildServer } = require("../src/simulator/adapters/http/server");

test("data status endpoint supports cached and forced statistics", async (context) => {
  const calls = [];
  const app = buildServer({ runtime: {
    getDataStatus: async (options) => {
      calls.push(options);
      return { generatedAt: "2026-07-13T00:00:00Z", periods: {}, strategyUniverse: null };
    },
  } });
  context.after(() => app.close());

  const cached = await app.inject({ method: "GET", url: "/api/data/status" });
  const refreshed = await app.inject({ method: "GET", url: "/api/data/status?refresh=true" });

  assert.equal(cached.statusCode, 200);
  assert.equal(refreshed.statusCode, 200);
  assert.deepEqual(calls, [{ refresh: false }, { refresh: true }]);
});
