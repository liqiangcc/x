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
    getDataStatusDetails: async (options) => ({ items: [{ code: "600001" }], ...options }),
    getDataStockChart: async (code) => ({ daily: [], security: { code }, yearly: [] }),
  } });
  context.after(() => app.close());

  const cached = await app.inject({ method: "GET", url: "/api/data/status" });
  const refreshed = await app.inject({ method: "GET", url: "/api/data/status?refresh=true" });

  assert.equal(cached.statusCode, 200);
  assert.equal(refreshed.statusCode, 200);
  assert.deepEqual(calls, [{ refresh: false }, { refresh: true }]);

  const details = await app.inject({ method: "GET", url: "/api/data/status/details?period=daily&category=date&date=2026-07-13&page=2&pageSize=50" });
  assert.equal(details.statusCode, 200);
  assert.deepEqual(details.json(), { category: "date", date: "2026-07-13", items: [{ code: "600001" }], page: 2, pageSize: 50, period: "daily" });

  const chart = await app.inject({ method: "GET", url: "/api/data/stocks/600001/chart" });
  assert.equal(chart.statusCode, 200);
  assert.deepEqual(chart.json(), { daily: [], security: { code: "600001" }, yearly: [] });
});
