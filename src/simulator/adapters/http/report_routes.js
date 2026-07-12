"use strict";

const { VERSION_BODY } = require("./session_routes");

async function reportRoutes(app, { runtime }) {
  app.post("/sessions/:sessionId/reveal", { schema: { body: VERSION_BODY } }, async (request) =>
    runtime.reveal(request.params.sessionId, request.body));
  app.post("/sessions/:sessionId/finish", { schema: { body: VERSION_BODY } }, async (request) =>
    runtime.finish(request.params.sessionId, request.body));
  app.get("/sessions/:sessionId/report", async (request) => runtime.getReport(request.params.sessionId));
  app.post("/sessions/:sessionId/export", async (request, reply) => reply.code(201).send(await runtime.exportSession(request.params.sessionId)));
}

module.exports = {
  reportRoutes,
};
