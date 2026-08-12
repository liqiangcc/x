"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const Database = require("better-sqlite3");
const { Client } = require("@modelcontextprotocol/client");
const { StdioClientTransport } = require("@modelcontextprotocol/client/stdio");

function structuredPayload(result) {
  if (result?.structuredContent && typeof result.structuredContent === "object") {
    return result.structuredContent;
  }
  const text = result?.content?.find((item) => item?.type === "text")?.text;
  if (typeof text !== "string") throw new TypeError("MCP tool result has no structuredContent or text payload.");
  return JSON.parse(text);
}

function createFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "x-mcp-strategy-e2e-"));
  const databasePath = path.join(dir, "signals.db");
  const db = new Database(databasePath);
  db.exec(`
    CREATE TABLE strategy_builds (
      id TEXT PRIMARY KEY,
      strategy_id TEXT NOT NULL,
      strategy_version INTEGER NOT NULL,
      data_version TEXT NOT NULL,
      status TEXT NOT NULL,
      phase TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      signal_count INTEGER NOT NULL DEFAULT 0,
      failure_reason TEXT,
      algorithm_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE strategy_signals (
      build_id TEXT NOT NULL,
      strategy_id TEXT NOT NULL,
      strategy_version INTEGER NOT NULL,
      data_version TEXT NOT NULL,
      trading_date TEXT NOT NULL,
      security_key TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (build_id, trading_date, security_key)
    );
  `);
  db.prepare(`INSERT INTO strategy_builds
    (id, strategy_id, strategy_version, data_version, status, phase, signal_count, algorithm_version, created_at)
    VALUES (?, ?, ?, ?, 'ready', 'done', ?, ?, ?)`)
    .run("build-e2e", "three_year_decline_breakout", 3, "ledger-v1", 2, 8, "2026-08-12T00:00:00Z");
  const insert = db.prepare(`INSERT INTO strategy_signals
    (build_id, strategy_id, strategy_version, data_version, trading_date, security_key, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  insert.run(
    "build-e2e",
    "three_year_decline_breakout",
    3,
    "ledger-v1",
    "2026-08-11",
    "1.600001",
    JSON.stringify({
      code: "600001",
      market: 1,
      securityKey: "1.600001",
      rankingValues: [10.5],
      evidence: { rule_summary: "first", today_close: 10.5 },
    })
  );
  insert.run(
    "build-e2e",
    "three_year_decline_breakout",
    3,
    "ledger-v1",
    "2026-08-11",
    "0.000001",
    JSON.stringify({
      code: "000001",
      market: 0,
      securityKey: "0.000001",
      rankingValues: [11.5],
      evidence: { rule_summary: "second", today_close: 11.5 },
    })
  );
  db.close();
  return { dir, databasePath };
}

function cleanEnv(extra) {
  return {
    ...Object.fromEntries(Object.entries(process.env).filter(([, value]) => typeof value === "string")),
    ...extra,
  };
}

test("stdio strategy_get_candidates reads an injected signal database without mutating it", { timeout: 20_000 }, async () => {
  const repositoryRoot = path.resolve(__dirname, "..");
  const fixture = createFixture();
  const before = fs.readFileSync(fixture.databasePath);
  const client = new Client(
    { name: "x-mcp-strategy-candidates-e2e", version: "0.1.0" },
    { versionNegotiation: { mode: "auto" } }
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(repositoryRoot, "src/adapters/mcp/stdio_entry.js")],
    cwd: repositoryRoot,
    env: cleanEnv({ X_MCP_SIGNAL_DATABASE_PATH: fixture.databasePath }),
  });

  try {
    await client.connect(transport);
    assert.equal(client.getProtocolEra(), "modern");

    const listed = await client.listTools();
    const tool = listed.tools.find((item) => item.name === "strategy_get_candidates");
    assert.ok(tool, "strategy_get_candidates must be discoverable over real stdio MCP");
    assert.equal(tool.annotations?.readOnlyHint, true);
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(tool.inputSchema.properties.limit.maximum, 200);
    assert.equal(tool.inputSchema.properties.includeEvidence.default, false);

    const compactResult = await client.callTool({
      name: "strategy_get_candidates",
      arguments: {
        strategyId: "three_year_decline_breakout",
        limit: 1,
      },
    });
    assert.notEqual(compactResult.isError, true);
    const compact = structuredPayload(compactResult);
    assert.equal(compact.status, "ready");
    assert.equal(compact.strategyId, "three_year_decline_breakout");
    assert.equal(compact.date, "2026-08-11");
    assert.equal(compact.build.id, "build-e2e");
    assert.equal(compact.build.algorithmVersion, 8);
    assert.equal(compact.candidates.length, 1);
    assert.equal(compact.candidates[0].rank, 1);
    assert.equal(compact.candidates[0].code, "600001");
    assert.equal(compact.candidates[0].evidence, undefined);
    assert.equal(compact.page.total, 2);
    assert.equal(compact.page.hasMore, true);
    assert.equal(compact.page.nextOffset, 1);
    assert.equal(compact.meta.source.kind, "simulator_strategy_signal_store");
    assert.equal(compact.meta.source.readonly, true);

    const detailedResult = await client.callTool({
      name: "strategy_get_candidates",
      arguments: {
        strategyId: "three_year_decline_breakout",
        date: "20260811",
        limit: 1,
        offset: compact.page.nextOffset,
        includeEvidence: true,
      },
    });
    assert.notEqual(detailedResult.isError, true);
    const detailed = structuredPayload(detailedResult);
    assert.equal(detailed.candidates.length, 1);
    assert.equal(detailed.candidates[0].rank, 2);
    assert.equal(detailed.candidates[0].code, "000001");
    assert.equal(detailed.candidates[0].evidence.rule_summary, "second");
    assert.equal(detailed.page.hasMore, false);
    assert.equal(detailed.page.nextOffset, null);
  } finally {
    await client.close();
    const after = fs.readFileSync(fixture.databasePath);
    assert.deepEqual(after, before);
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});
