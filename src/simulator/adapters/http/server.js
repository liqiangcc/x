"use strict";

const Fastify = require("fastify");
const { SimulatorRuntimeService } = require("../../application/runtime_service");
const { SimulatorRepository } = require("../sqlite/repository");
const { sessionRoutes } = require("./session_routes");
const { orderRoutes } = require("./order_routes");
const { queryRoutes } = require("./query_routes");
const { reportRoutes } = require("./report_routes");
const { accountRoutes } = require("./account_routes");

function statusFor(error) {
  if (error.statusCode) return error.statusCode;
  if (["session_version_conflict", "invalid_session_state", "decision_locked", "blind_reveal_locked", "identity_already_revealed", "accepted_orders_block_skip"].includes(error.code)) return 409;
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

function timingThreshold(value) {
  const milliseconds = Number(value);
  return Number.isFinite(milliseconds) && milliseconds >= 0 ? milliseconds : 300;
}

function buildServer({ logger = false, runtime = new SimulatorRuntimeService(), slowRequestMs = process.env.SIMULATOR_SLOW_REQUEST_MS } = {}) {
  const app = Fastify({ logger });
  const slowThreshold = timingThreshold(slowRequestMs);
  app.addHook("onRequest", (request, _reply, done) => {
    request.apiTimingStartedAt = process.hrtime.bigint();
    done();
  });
  app.addHook("onResponse", (request, reply, done) => {
    const startedAt = request.apiTimingStartedAt;
    const durationMs = typeof startedAt === "bigint" ? Number(process.hrtime.bigint() - startedAt) / 1e6 : null;
    const timing = {
      durationMs: durationMs === null ? null : Number(durationMs.toFixed(2)),
      method: request.method,
      route: request.routeOptions?.url ?? request.url.split("?")[0],
      statusCode: reply.statusCode,
    };
    app.log.info({ event: "api_timing", ...timing }, "API timing");
    if (durationMs !== null && durationMs >= slowThreshold) {
      app.log.warn({ event: "slow_api_request", slowThresholdMs: slowThreshold, ...timing }, "Slow API request");
    }
    done();
  });
  app.setErrorHandler((error, _request, reply) => reply.code(error.validation ? 400 : statusFor(error)).send(errorBody(error)));
  app.get("/health", async () => ({ ok: true }));
  app.register(sessionRoutes, { prefix: "/api", runtime });
  app.register(orderRoutes, { prefix: "/api", runtime });
  app.register(queryRoutes, { prefix: "/api", runtime });
  app.register(reportRoutes, { prefix: "/api", runtime });
  app.register(accountRoutes, { prefix: "/api", runtime });
  return app;
}

async function start() {
  const repository = new SimulatorRepository();
  const slowThreshold = timingThreshold(process.env.SIMULATOR_SLOW_REQUEST_MS);
  let logPerformance = null;
  const runtime = new SimulatorRuntimeService({
    onPerformance: (timing) => logPerformance?.(timing),
    repository,
  });
  const app = buildServer({ logger: true, runtime });
  logPerformance = (timing) => {
    const level = timing.durationMs >= slowThreshold ? "warn" : "info";
    app.log[level]({ event: "operation_timing", ...timing }, "Simulator operation timing");
  };
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
  timingThreshold,
};
