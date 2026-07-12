"use strict";

const Fastify = require("fastify");
const { SimulatorRuntimeService } = require("../../application/runtime_service");
const { SimulatorRepository } = require("../sqlite/repository");
const { sessionRoutes } = require("./session_routes");
const { orderRoutes } = require("./order_routes");
const { queryRoutes } = require("./query_routes");

function statusFor(error) {
  if (error.statusCode) return error.statusCode;
  if (["session_version_conflict", "invalid_session_state", "decision_locked"].includes(error.code)) return 409;
  if (["session_not_found", "order_not_found", "unknown_candidate"].includes(error.code)) return 404;
  return 422;
}

function errorBody(error) {
  return {
    error: {
      code: error.validation ? "invalid_request" : (error.code ?? "business_error"),
      issues: error.validation?.map((issue) => ({ field: issue.instancePath || issue.params?.missingProperty || "request", message: issue.message })) ?? error.issues ?? [],
      message: error.validation ? "Request validation failed." : error.message,
    },
  };
}

function buildServer({ logger = false, runtime = new SimulatorRuntimeService() } = {}) {
  const app = Fastify({ logger });
  app.setErrorHandler((error, _request, reply) => reply.code(error.validation ? 400 : statusFor(error)).send(errorBody(error)));
  app.get("/health", async () => ({ ok: true }));
  app.register(sessionRoutes, { prefix: "/api", runtime });
  app.register(orderRoutes, { prefix: "/api", runtime });
  app.register(queryRoutes, { prefix: "/api", runtime });
  return app;
}

async function start() {
  const repository = new SimulatorRepository();
  const app = buildServer({ logger: true, runtime: new SimulatorRuntimeService({ repository }) });
  await app.listen({ host: process.env.SIMULATOR_HOST ?? "127.0.0.1", port: Number(process.env.SIMULATOR_PORT ?? 3001) });
}

if (require.main === module) {
  start().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildServer,
  errorBody,
  start,
  statusFor,
};
