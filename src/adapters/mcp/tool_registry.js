"use strict";

function assertMcpTool(tool) {
  if (!tool || typeof tool !== "object") {
    throw new TypeError("MCP tool must be an object.");
  }
  const name = tool.definition?.name;
  if (typeof name !== "string" || !name.trim()) {
    throw new TypeError("MCP tool definition.name must be a non-empty string.");
  }
  if (typeof tool.handler !== "function") {
    throw new TypeError(`MCP tool ${name} must provide handler().`);
  }
  return tool;
}

function unknownToolError(name) {
  const error = new Error(`Unknown MCP tool: ${name}`);
  error.code = "unknown_mcp_tool";
  return error;
}

class McpToolRegistry {
  constructor({ tools = [] } = {}) {
    if (!Array.isArray(tools)) throw new TypeError("tools must be an array.");
    this.tools = new Map();
    for (const tool of tools) this.register(tool);
  }

  register(tool) {
    const validated = assertMcpTool(tool);
    const name = validated.definition.name;
    if (this.tools.has(name)) {
      const error = new Error(`Duplicate MCP tool: ${name}`);
      error.code = "duplicate_mcp_tool";
      throw error;
    }
    this.tools.set(name, validated);
    return this;
  }

  has(name) {
    return this.tools.has(String(name));
  }

  get(name) {
    return this.tools.get(String(name)) ?? null;
  }

  listDefinitions() {
    return [...this.tools.values()].map((tool) => tool.definition);
  }

  async invoke(name, input = {}) {
    const tool = this.get(name);
    if (!tool) throw unknownToolError(name);
    return tool.handler(input);
  }
}

module.exports = {
  McpToolRegistry,
  assertMcpTool,
  unknownToolError,
};
