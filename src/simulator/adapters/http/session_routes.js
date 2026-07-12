"use strict";

const VERSION_BODY = {
  additionalProperties: false,
  properties: { expectedVersion: { minimum: 1, type: "integer" } },
  required: ["expectedVersion"],
  type: "object",
};

async function sessionRoutes(app, { runtime }) {
  app.post("/sessions", {
    schema: {
      body: {
        additionalProperties: false,
        properties: {
          endDate: { pattern: "^\\d{4}-?\\d{2}-?\\d{2}$", type: "string" },
          initialCash: { exclusiveMinimum: 0, type: "number" },
          mode: { enum: ["manual", "blind"], type: "string" },
          selection: { type: "object" },
          startDate: { pattern: "^\\d{4}-?\\d{2}-?\\d{2}$", type: "string" },
        },
        required: ["startDate", "endDate"],
        type: "object",
      },
    },
  }, async (request, reply) => reply.code(201).send(await runtime.createSession(request.body)));

  app.get("/sessions/:sessionId", async (request) => runtime.getSession(request.params.sessionId));
  app.post("/sessions/:sessionId/complete-decision", { schema: { body: VERSION_BODY } }, async (request) =>
    runtime.completeDecision(request.params.sessionId, request.body));
  app.post("/sessions/:sessionId/advance", { schema: { body: VERSION_BODY } }, async (request) =>
    runtime.advance(request.params.sessionId, request.body));
}

module.exports = {
  VERSION_BODY,
  sessionRoutes,
};
