"use strict";

const { serveStdio } = require("@modelcontextprotocol/server/stdio");
const { createMcpCompositionRoot } = require("./composition_root");
const { createMcpSdkServer } = require("./sdk_server");

function buildMcpServer({
  composition = {},
  server = {},
} = {}) {
  const root = createMcpCompositionRoot(composition);
  return createMcpSdkServer({ registry: root.registry, ...server });
}

function startMcpStdio({
  composition = {},
  server = {},
  serveStdioImpl = serveStdio,
} = {}) {
  if (typeof serveStdioImpl !== "function") {
    throw new TypeError("serveStdioImpl must be a function.");
  }
  return serveStdioImpl(() => buildMcpServer({ composition, server }));
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
  installShutdownHandlers,
  startMcpStdio,
};
