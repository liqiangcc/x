"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { XDataMcpClient } = require("../src/adapters/xdata/x_data_mcp_client");

async function withServer(handler, callback) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "x-data-mcp-client-"));
  const socketPath = path.join(dir, "mcp.sock");
  const server = net.createServer((socket) => {
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buffer += chunk;
      for (;;) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) break;
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const request = JSON.parse(line);
        const response = handler(request);
        if (response) socket.write(`${JSON.stringify(response)}\n`);
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  try {
    return await callback(socketPath);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("XDataMcpClient performs newline JSON-RPC tool calls over a unix socket", async () => {
  await withServer((request) => {
    assert.equal(request.jsonrpc, "2.0");
    if (request.method === "tools/call") {
      return {
        jsonrpc: "2.0",
        id: request.id,
        result: {
          isError: false,
          structuredContent: { ok: true, echoed: request.params.arguments.value },
        },
      };
    }
    return {
      jsonrpc: "2.0",
      id: request.id,
      error: { code: -32601, message: "unsupported" },
    };
  }, async (socketPath) => {
    const client = new XDataMcpClient({ socketPath, timeoutMs: 5_000 });
    try {
      const result = await client.callTool("query_data", { value: 17 });
      assert.deepEqual(result, { ok: true, echoed: 17 });
    } finally {
      await client.close();
    }
  });
});

test("XDataMcpClient preserves tool business errors as stable failures", async () => {
  await withServer((request) => ({
    jsonrpc: "2.0",
    id: request.id,
    result: {
      isError: true,
      structuredContent: { code: "PUBLISHED_DATA_UNAVAILABLE", message: "missing version" },
    },
  }), async (socketPath) => {
    const client = new XDataMcpClient({ socketPath });
    await assert.rejects(
      () => client.callTool("query_data", {}),
      (error) => error.code === "PUBLISHED_DATA_UNAVAILABLE" && /missing version/.test(error.message)
    );
    await client.close();
  });
});
