"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { Server } = require("@modelcontextprotocol/server");
const { serveStdio } = require("@modelcontextprotocol/server/stdio");
const {
  createMcpSdkServer,
} = require("../src/adapters/mcp/sdk_server");
const {
  installShutdownHandlers,
  startMcpStdio,
} = require("../src/adapters/mcp/stdio_entry");

class FakeProtocolError extends Error {
  constructor(code, message, data) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

class FakeServer {
  constructor(info, options) {
    this.info = info;
    this.options = options;
    this.handlers = new Map();
  }

  setRequestHandler(method, handler) {
    this.handlers.set(method, handler);
  }
}

function fakeRegistry() {
  const calls = [];
  const definitions = [{
    name: "echo",
    description: "Echo a value.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { value: { type: "string" } },
      required: ["value"],
    },
  }];
  return {
    calls,
    has(name) {
      return name === "echo";
    },
    listDefinitions() {
      return definitions;
    },
    async invoke(name, input) {
      calls.push({ name, input });
      return { content: [{ type: "text", text: input.value }] };
    },
  };
}

test("official MCP v2 server and stdio entry are loadable from CommonJS", () => {
  assert.equal(typeof Server, "function");
  assert.equal(typeof serveStdio, "function");
});

test("SDK server bridge exposes registry definitions and delegates valid calls", async () => {
  const registry = fakeRegistry();
  const server = createMcpSdkServer({
    registry,
    ServerClass: FakeServer,
    ProtocolErrorClass: FakeProtocolError,
    invalidParamsCode: "INVALID_PARAMS",
  });

  assert.deepEqual(server.info, { name: "x-stock-data-mcp", version: "0.1.0" });
  assert.deepEqual(server.options, { capabilities: { tools: {} } });

  const listed = await server.handlers.get("tools/list")({ method: "tools/list", params: {} });
  assert.deepEqual(listed.tools, registry.listDefinitions());

  const result = await server.handlers.get("tools/call")({
    method: "tools/call",
    params: { name: "echo", arguments: { value: "ok" } },
  });
  assert.deepEqual(result, { content: [{ type: "text", text: "ok" }] });
  assert.deepEqual(registry.calls, [{ name: "echo", input: { value: "ok" } }]);
});

test("SDK server bridge rejects unknown tools before registry invocation", async () => {
  const registry = fakeRegistry();
  const server = createMcpSdkServer({
    registry,
    ServerClass: FakeServer,
    ProtocolErrorClass: FakeProtocolError,
    invalidParamsCode: "INVALID_PARAMS",
  });

  await assert.rejects(
    () => server.handlers.get("tools/call")({ params: { name: "missing", arguments: {} } }),
    (error) => error instanceof FakeProtocolError
      && error.code === "INVALID_PARAMS"
      && /Unknown MCP tool/.test(error.message)
  );
  assert.deepEqual(registry.calls, []);
});

test("SDK server bridge validates tool JSON Schema before application control", async () => {
  const registry = fakeRegistry();
  const server = createMcpSdkServer({
    registry,
    ServerClass: FakeServer,
    ProtocolErrorClass: FakeProtocolError,
    invalidParamsCode: "INVALID_PARAMS",
  });

  await assert.rejects(
    () => server.handlers.get("tools/call")({
      params: { name: "echo", arguments: { value: "ok", unexpected: true } },
    }),
    (error) => error instanceof FakeProtocolError
      && error.code === "INVALID_PARAMS"
      && Array.isArray(error.data?.errors)
      && error.data.errors.some((item) => item.keyword === "additionalProperties")
  );
  assert.deepEqual(registry.calls, []);
});

test("stdio entry delegates transport ownership to serveStdio factory", () => {
  let factory = null;
  const handle = { close: async () => {} };
  const drawdownsTool = {
    definition: { name: "analytics_get_drawdowns", inputSchema: { type: "object" } },
    handler: async () => ({ content: [] }),
  };

  const returned = startMcpStdio({
    composition: { drawdownsTool },
    server: {
      ServerClass: FakeServer,
      ProtocolErrorClass: FakeProtocolError,
      invalidParamsCode: "INVALID_PARAMS",
    },
    serveStdioImpl(inputFactory) {
      factory = inputFactory;
      return handle;
    },
  });

  assert.equal(returned, handle);
  const server = factory();
  assert.ok(server instanceof FakeServer);
  assert.equal(server.handlers.has("tools/list"), true);
  assert.equal(server.handlers.has("tools/call"), true);
});

test("stdio shutdown handlers only close the transport handle", async () => {
  const installed = new Map();
  let closeCount = 0;
  installShutdownHandlers({ close: async () => { closeCount += 1; } }, {
    once(signal, handler) {
      installed.set(signal, handler);
    },
  });

  assert.deepEqual([...installed.keys()], ["SIGINT", "SIGTERM"]);
  installed.get("SIGINT")();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closeCount, 1);
});
