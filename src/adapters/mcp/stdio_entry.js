"use strict";

const { serveStdio } = require("@modelcontextprotocol/server/stdio");
const { createMcpCompositionRoot } = require("./composition_root");
const { createMcpSdkServer } = require("./sdk_server");

function compositionFromEnvironment(composition = {}, env = process.env) {
  if (composition.signalReader || composition.signalDatabasePath) return composition;
  const databasePath = String(env.X_MCP_SIGNAL_DATABASE_PATH ?? "").trim();
  return databasePath
    ? { ...composition, signalDatabasePath: databasePath }
    : composition;
}

function buildMcpServer({
  composition = {},
  server = {},
  env = process.env,
} = {}) {
  const root = createMcpCompositionRoot(compositionFromEnvironment(composition, env));
  return createMcpSdkServer({ registry: root.registry, ...server });
}

function startMcpStdio({
  composition = {},
  server = {},
  env = process.env,
  serveStdioImpl = serveStdio,
} = {}) {
  if (typeof serveStdioImpl !== "function") {
    throw new TypeError("serveStdioImpl must be a function.");
  }
  return serveStdioImpl(() => buildMcpServer({ composition, server, env }));
}

function installShutdownHandlers(handle, processImpl = process) {
  if (!handle || typeof handle.close !== "function") {
    throw new TypeError("stdio handle must provide close().");
  }
  for (const signal of ["SIGINT", "SIGTERM"]) {
    processImpl.once(signal, () => {
      void handle.close();
    });
  }
}

if (require.main === module) {
  const handle = startMcpStdio();
  installShutdownHandlers(handle);
  console.error("x stock data MCP server listening on stdio");
}

module.exports = {
  buildMcpServer,
  compositionFromEnvironment,
  installShutdownHandlers,
  startMcpStdio,
};
