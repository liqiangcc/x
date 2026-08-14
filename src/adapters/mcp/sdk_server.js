"use strict";

const Ajv = require("ajv");
const {
  ProtocolError,
  ProtocolErrorCode,
  Server,
} = require("@modelcontextprotocol/server");

const DEFAULT_SERVER_INFO = Object.freeze({
  name: "x-stock-data-mcp",
  version: "0.1.0",
});

function assertRegistry(registry) {
  if (!registry || typeof registry !== "object") {
    throw new TypeError("registry must be an object.");
  }
  for (const method of ["has", "invoke", "listDefinitions"]) {
    if (typeof registry[method] !== "function") {
      throw new TypeError(`registry must provide ${method}().`);
    }
  }
  return registry;
}

function formatValidationErrors(errors = []) {
  return errors.map((error) => ({
    instancePath: error.instancePath ?? "",
    keyword: error.keyword ?? "validation",
    message: error.message ?? "invalid value",
  }));
}

function invalidParams(message, data = undefined, {
  ProtocolErrorClass = ProtocolError,
  invalidParamsCode = ProtocolErrorCode.InvalidParams,
} = {}) {
  return new ProtocolErrorClass(invalidParamsCode, message, data);
}

function compileInputValidators(definitions, ajv) {
  const validators = new Map();
  for (const definition of definitions) {
    validators.set(definition.name, ajv.compile(definition.inputSchema ?? { type: "object" }));
  }
  return validators;
}

function createMcpSdkServer({
  registry,
  serverInfo = DEFAULT_SERVER_INFO,
  ServerClass = Server,
  ProtocolErrorClass = ProtocolError,
  invalidParamsCode = ProtocolErrorCode.InvalidParams,
  ajv = new Ajv({ allErrors: true, strict: false }),
} = {}) {
  const resolvedRegistry = assertRegistry(registry);
  if (typeof ServerClass !== "function") throw new TypeError("ServerClass must be a constructor.");
  if (!ajv || typeof ajv.compile !== "function") throw new TypeError("ajv must provide compile().");

  const definitions = resolvedRegistry.listDefinitions();
  if (!Array.isArray(definitions)) throw new TypeError("registry.listDefinitions() must return an array.");
  const validators = compileInputValidators(definitions, ajv);
  const server = new ServerClass(serverInfo, { capabilities: { tools: {} } });
  if (!server || typeof server.setRequestHandler !== "function") {
    throw new TypeError("MCP SDK Server must provide setRequestHandler().");
  }

  server.setRequestHandler("tools/list", async () => ({
    tools: resolvedRegistry.listDefinitions(),
  }));

  server.setRequestHandler("tools/call", async (request) => {
    const name = request?.params?.name;
    if (typeof name !== "string" || !name || !resolvedRegistry.has(name)) {
      throw invalidParams(`Unknown MCP tool: ${String(name ?? "")}`, undefined, {
        ProtocolErrorClass,
        invalidParamsCode,
      });
    }

    const input = request?.params?.arguments ?? {};
    const validate = validators.get(name);
    if (validate && !validate(input)) {
      throw invalidParams(`Invalid arguments for MCP tool: ${name}`, {
        errors: formatValidationErrors(validate.errors),
      }, {
        ProtocolErrorClass,
        invalidParamsCode,
      });
    }

    return resolvedRegistry.invoke(name, input);
  });

  return server;
}

module.exports = {
  DEFAULT_SERVER_INFO,
  assertRegistry,
  compileInputValidators,
  createMcpSdkServer,
  formatValidationErrors,
  invalidParams,
};
