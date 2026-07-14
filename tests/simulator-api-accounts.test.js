"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildServer } = require("../src/simulator/adapters/http/server");

function runtime() {
  return {
    addWatchlist: (_id, ids) => ({ items: ids.map((candidateId) => ({ candidateId })) }),
    advanceAccount: (_id, body) => ({ clock: { currentDate: "2026-07-02" }, version: body.expectedVersion + 2 }),
    calculateAccountCandidates: (_id, body) => ({ calculation: { status: "completed", strategyId: body.strategyId }, snapshot: { candidates: [] } }),
    createAccount: (body) => ({ id: "account-1", name: body.name, startMode: body.startMode }),
    deleteStrategy: () => null,
    getAccount: (id) => ({ id }),
    getAccountCandidates: () => ({ calculated: false, pagination: { items: [] } }),
    getChart: (_id, candidateId) => ({ candidateId, daily: [], yearly: [] }),
    getStrategyBuilderCatalog: () => ({ indicators: [], rules: [] }),
    listAccounts: () => ({ accounts: [{ id: "account-1" }] }),
    listStrategies: () => ({ strategies: [{ id: "default" }] }),
    listStrategyTemplates: () => ({ templates: [{ id: "preset" }] }),
    listWatchlist: () => ({ items: [] }),
    removeWatchlist: () => ({ items: [] }),
    saveStrategy: (body, id = "strategy-1") => ({ ...body, id }),
    saveStrategyTemplate: (body, id = "template-1") => ({ ...body, id }),
    deleteStrategyTemplate: () => null,
    validateStrategy: () => ({ description: "有效策略" }),
  };
}

test("account API creates, calculates, advances and manages watchlist", async (t) => {
  const app = buildServer({ runtime: runtime() });
  t.after(() => app.close());
  const created = await app.inject({ method: "POST", payload: { initialCash: 100000, name: "练习", startMode: "random" }, url: "/api/accounts" });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().id, "account-1");
  const calculated = await app.inject({ method: "POST", payload: { expectedVersion: 1, strategyId: "default" }, url: "/api/accounts/account-1/candidate-calculations" });
  assert.equal(calculated.json().calculation.status, "completed");
  const added = await app.inject({ method: "POST", payload: { candidateIds: ["cand-a"] }, url: "/api/accounts/account-1/watchlist/bulk" });
  assert.equal(added.json().items[0].candidateId, "cand-a");
  const advanced = await app.inject({ method: "POST", payload: { expectedVersion: 1 }, url: "/api/accounts/account-1/advance" });
  assert.equal(advanced.json().clock.currentDate, "2026-07-02");
});

test("strategy template API supports create, list, update and delete", async (t) => {
  const app = buildServer({ runtime: runtime() });
  t.after(() => app.close());
  assert.equal((await app.inject({ method: "GET", url: "/api/strategies" })).json().strategies.length, 1);
  const created = await app.inject({ method: "POST", payload: { config: {}, name: "策略" }, url: "/api/strategies" });
  assert.equal(created.statusCode, 201);
  assert.equal((await app.inject({ method: "PUT", payload: { config: {}, name: "新版" }, url: "/api/strategies/strategy-1" })).json().name, "新版");
  assert.equal((await app.inject({ method: "DELETE", url: "/api/strategies/strategy-1" })).statusCode, 204);
  assert.equal((await app.inject({ method: "GET", url: "/api/strategy-builder/catalog" })).statusCode, 200);
  assert.equal((await app.inject({ method: "POST", payload: { strategy: {} }, url: "/api/strategies/validate" })).json().description, "有效策略");
  assert.equal((await app.inject({ method: "GET", url: "/api/strategy-templates" })).json().templates.length, 1);
  assert.equal((await app.inject({ method: "POST", payload: { definition: {}, name: "模板" }, url: "/api/strategy-templates" })).statusCode, 201);
  assert.equal((await app.inject({ method: "PUT", payload: { definition: {}, name: "新版模板" }, url: "/api/strategy-templates/template-1" })).json().name, "新版模板");
  assert.equal((await app.inject({ method: "DELETE", url: "/api/strategy-templates/template-1" })).statusCode, 204);
});
