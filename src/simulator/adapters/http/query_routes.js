"use strict";

async function queryRoutes(app, { runtime }) {
  app.get("/data/status", async (request) => runtime.getDataStatus({ refresh: request.query.refresh === "true" }));
  app.get("/data/status/details", async (request) => runtime.getDataStatusDetails({
    category: request.query.category ?? "all",
    date: request.query.date ?? null,
    page: request.query.page === undefined ? 1 : Number(request.query.page),
    pageSize: request.query.pageSize === undefined ? 100 : Number(request.query.pageSize),
    period: request.query.period,
  }));
  app.get("/data/stocks/:code/chart", async (request) => runtime.getDataStockChart(request.params.code));
  app.get("/data/proxy-quality", async () => runtime.getProxyQuality());
  app.post("/data/proxy-quality/refresh", async (_request, reply) => reply.code(202).send(runtime.refreshProxyQuality()));
  app.get("/sessions/:sessionId/candidates", async (request) => runtime.getCandidates(request.params.sessionId, {
    page: request.query.page === undefined ? 1 : Number(request.query.page),
    pageSize: request.query.pageSize === undefined ? 20 : Number(request.query.pageSize),
    viewAll: request.query.viewAll === "true",
  }));
  app.get("/sessions/:sessionId/chart/:candidateId", async (request) => runtime.getChart(request.params.sessionId, request.params.candidateId));
  app.get("/sessions/:sessionId/portfolio", async (request) => runtime.getPortfolio(request.params.sessionId));
}

module.exports = {
  queryRoutes,
};
