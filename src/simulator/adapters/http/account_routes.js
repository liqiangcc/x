"use strict";

const VERSION = { minimum: 1, type: "integer" };

async function accountRoutes(app, { runtime }) {
  app.get("/accounts", async () => runtime.listAccounts());
  app.post("/accounts", {
    schema: { body: { additionalProperties: false, properties: {
      initialCash: { exclusiveMinimum: 0, type: "number" },
      name: { minLength: 1, type: "string" },
      startDate: { pattern: "^\\d{4}-\\d{2}-\\d{2}$", type: "string" },
      startMode: { enum: ["random", "specified"], type: "string" },
      strategyId: { type: "string" },
    }, required: ["initialCash", "name", "startMode"], type: "object" } },
  }, async (request, reply) => reply.code(201).send(await runtime.createAccount(request.body)));
  app.get("/accounts/:accountId", async (request) => runtime.getAccount(request.params.accountId));
  app.post("/accounts/:accountId/advance", {
    schema: { body: { additionalProperties: false, properties: { expectedVersion: VERSION }, required: ["expectedVersion"], type: "object" } },
  }, async (request) => runtime.advanceAccount(request.params.accountId, request.body));
  app.get("/accounts/:accountId/candidates", async (request) => runtime.getAccountCandidates(request.params.accountId, {
    page: request.query.page === undefined ? 1 : Number(request.query.page),
    pageSize: request.query.pageSize === undefined ? 20 : Number(request.query.pageSize),
    viewAll: request.query.viewAll === "true",
  }));
  app.post("/accounts/:accountId/candidate-calculations", {
    schema: { body: { additionalProperties: false, properties: {
      expectedVersion: VERSION, strategyId: { minLength: 1, type: "string" },
    }, required: ["expectedVersion", "strategyId"], type: "object" } },
  }, async (request, reply) => reply.code(201).send(await runtime.calculateAccountCandidates(request.params.accountId, request.body)));
  app.get("/accounts/:accountId/watchlist", async (request) => runtime.listWatchlist(request.params.accountId));
  app.post("/accounts/:accountId/watchlist", {
    schema: { body: { additionalProperties: false, properties: { candidateId: { minLength: 1, type: "string" } }, required: ["candidateId"], type: "object" } },
  }, async (request) => runtime.addWatchlist(request.params.accountId, [request.body.candidateId]));
  app.post("/accounts/:accountId/watchlist/bulk", {
    schema: { body: { additionalProperties: false, properties: { candidateIds: { items: { minLength: 1, type: "string" }, type: "array" } }, required: ["candidateIds"], type: "object" } },
  }, async (request) => runtime.addWatchlist(request.params.accountId, request.body.candidateIds));
  app.delete("/accounts/:accountId/watchlist/:candidateId", async (request) => runtime.removeWatchlist(request.params.accountId, request.params.candidateId));
  app.get("/accounts/:accountId/stocks/:candidateId/chart", async (request) => runtime.getChart(request.params.accountId, request.params.candidateId));

  app.get("/strategies", async () => runtime.listStrategies());
  app.get("/strategy-syncs", async () => runtime.listStrategySyncs());
  app.get("/strategies/:strategyId/build", async (request) => runtime.getStrategyBuild(request.params.strategyId));
  app.get("/strategies/:strategyId/sync", async (request) => runtime.getStrategySync(request.params.strategyId));
  app.post("/strategies/:strategyId/sync", async (request, reply) => reply.code(202).send(runtime.startStrategySync(request.params.strategyId)));
  app.post("/strategies/:strategyId/rebuild", async (request) => runtime.rebuildStrategy(request.params.strategyId));
  app.post("/strategies", {
    schema: { body: { additionalProperties: false, properties: { config: { type: "object" }, name: { minLength: 1, type: "string" } }, required: ["config", "name"], type: "object" } },
  }, async (request, reply) => reply.code(201).send(runtime.saveStrategy(request.body)));
  app.put("/strategies/:strategyId", async (request) => runtime.saveStrategy(request.body, request.params.strategyId));
  app.delete("/strategies/:strategyId", async (request, reply) => {
    runtime.deleteStrategy(request.params.strategyId);
    return reply.code(204).send();
  });
}

module.exports = { accountRoutes };
