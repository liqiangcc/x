"use strict";

const net = require("node:net");

const DEFAULT_TIMEOUT_MS = 30_000;

function makeError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details !== null && details !== undefined) error.details = details;
  return error;
}

class XDataMcpClient {
  constructor({ socketPath, timeoutMs = DEFAULT_TIMEOUT_MS, connectImpl = null } = {}) {
    const path = String(socketPath ?? "").trim();
    if (!path) throw new TypeError("socketPath must be a non-empty string.");
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
      throw new TypeError("timeoutMs must be a positive integer.");
    }
    this.socketPath = path;
    this.timeoutMs = timeoutMs;
    this.connectImpl = connectImpl ?? net.createConnection;
    this.nextId = 0;
    this.socket = null;
    this.connecting = null;
    this.pending = new Map();
    this.buffer = "";
    this.closed = false;
  }

  async connect() {
    if (this.socket) return;
    if (this.connecting) return this.connecting;
    this.connecting = new Promise((resolve, reject) => {
      const socket = this.connectImpl(this.socketPath);
      const onError = (error) => {
        this.connecting = null;
        reject(error);
      };
      socket.setNoDelay?.(true);
      socket.setEncoding?.("utf8");
      socket.once("error", onError);
      socket.once("connect", () => {
        socket.off("error", onError);
        this.socket = socket;
        socket.on("data", (chunk) => this.#receive(chunk));
        socket.on("error", (error) => this.#failAll(error));
        socket.on("close", () => this.#failAll(makeError("x_data_mcp_closed", "x-data-mcp socket closed.")));
        this.connecting = null;
        resolve();
      });
    });
    return this.connecting;
  }

  #receive(chunk) {
    this.buffer += chunk;
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) return;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let response;
      try {
        response = JSON.parse(line);
      } catch (error) {
        this.#failAll(makeError("x_data_mcp_invalid_json", "x-data-mcp returned invalid JSON.", line));
        continue;
      }
      const id = response.id;
      const key = String(id);
      const pending = this.pending.get(key);
      if (!pending) continue;
      this.pending.delete(key);
      clearTimeout(pending.timer);
      if (response.error) {
        const rpc = response.error;
        pending.reject(makeError(
          rpc.code === undefined ? "x_data_mcp_rpc_error" : `x_data_mcp_rpc_${rpc.code}`,
          rpc.message ?? "x-data-mcp RPC error.",
          rpc
        ));
      } else {
        pending.resolve(response.result);
      }
    }
  }

  #failAll(error) {
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const item of pending) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    if (this.socket) {
      try {
        this.socket.destroy();
      } finally {
        this.socket = null;
      }
    }
  }

  async request(method, params = {}) {
    await this.connect();
    const id = ++this.nextId;
    const payload = { jsonrpc: "2.0", id, method, params };
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(String(id));
        reject(makeError("x_data_mcp_timeout", `x-data-mcp request timed out after ${this.timeoutMs}ms.`));
      }, this.timeoutMs);
      this.pending.set(String(id), { resolve, reject, timer });
    });
    await new Promise((resolve, reject) => {
      this.socket.write(`${JSON.stringify(payload)}\n`, (error) => error ? reject(error) : resolve());
    });
    return promise;
  }

  async callTool(name, args = {}) {
    const result = await this.request("tools/call", { name, arguments: args });
    if (result?.isError === true) {
      const payload = result.structuredContent ?? {};
      throw makeError(
        payload.code ?? "x_data_mcp_tool_error",
        payload.message ?? `x-data-mcp tool ${name} failed.`,
        payload
      );
    }
    return result?.structuredContent;
  }

  async listTools() {
    const result = await this.request("tools/list");
    return result?.tools ?? [];
  }

  async close() {
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.end();
      socket.destroy();
    }
    this.#failAll(makeError("x_data_mcp_closed", "x-data-mcp client closed."));
  }
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  XDataMcpClient,
};
