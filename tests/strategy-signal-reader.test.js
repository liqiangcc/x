"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const Database = require("better-sqlite3");
const { assertSignalReader } = require("../src/ports/strategy/signal_reader");
const { ReadonlySqliteSignalReader } = require("../src/adapters/strategy/readonly_sqlite_signal_reader");
const { GetStrategyCandidatesUseCase } = require("../src/application/strategy/get_strategy_candidates");

function createSignalDatabase() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "x-mcp-signals-"));
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
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run("build-old", "alpha", 1, "v1", "ready", "done", 1, 7, "2026-01-01T00:00:00Z");
  db.prepare(`INSERT INTO strategy_builds
    (id, strategy_id, strategy_version, data_version, status, phase, signal_count, algorithm_version, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run("build-new", "alpha", 2, "v2", "ready", "done", 3, 8, "2026-02-01T00:00:00Z");
  const insert = db.prepare(`INSERT INTO strategy_signals
    (build_id, strategy_id, strategy_version, data_version, trading_date, security_key, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  for (const [index, code] of ["600001", "600002", "600003"].entries()) {
    insert.run(
      "build-new",
      "alpha",
      2,
      "v2",
      "2026-02-10",
      `1.${code}`,
      JSON.stringify({
        code,
        market: 1,
        securityKey: `1.${code}`,
        rankingValues: [index + 1],
        evidence: { rule: `r${index + 1}` },
      })
    );
  }
  insert.run(
    "build-new",
    "alpha",
    2,
    "v2",
    "2026-02-11",
    "1.600010",
    JSON.stringify({
      code: "600010",
      market: 1,
      securityKey: "1.600010",
      rankingValues: [10],
      evidence: { rule: "latest" },
    })
  );
  db.close();
  return { dir, databasePath };
}

test("SignalReader port requires getStrategyCandidates()", () => {
  const reader = { async getStrategyCandidates() {} };
  assert.equal(assertSignalReader(reader), reader);
  assert.throws(() => assertSignalReader(), /getStrategyCandidates/);
  assert.throws(() => assertSignalReader({}), /getStrategyCandidates/);
});

test("readonly SQLite SignalReader selects latest ready build, latest date, and never mutates the database", async () => {
  const fixture = createSignalDatabase();
  try {
    const before = fs.readFileSync(fixture.databasePath);
    const reader = new ReadonlySqliteSignalReader({ databasePath: fixture.databasePath });
    const result = await reader.getStrategyCandidates({ strategyId: "alpha", limit: 2 });
    const after = fs.readFileSync(fixture.databasePath);

    assert.deepEqual(after, before);
    assert.equal(result.status, "ready");
    assert.equal(result.build.id, "build-new");
    assert.equal(result.build.strategyVersion, 2);
    assert.equal(result.build.algorithmVersion, 8);
    assert.equal(result.date, "2026-02-11");
    assert.equal(result.page.total, 1);
    assert.equal(result.page.hasMore, false);
    assert.deepEqual(result.candidates.map((item) => item.code), ["600010"]);
    assert.equal(result.source.readonly, true);
  } finally {
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("readonly SQLite SignalReader preserves insertion ranking and bounded pagination for a requested date", async () => {
  const fixture = createSignalDatabase();
  try {
    const reader = new ReadonlySqliteSignalReader({ databasePath: fixture.databasePath });
    const first = await reader.getStrategyCandidates({
      strategyId: "alpha",
      date: "20260210",
      limit: 2,
      offset: 0,
    });
    assert.equal(first.date, "2026-02-10");
    assert.deepEqual(first.candidates.map((item) => [item.rank, item.code]), [
      [1, "600001"],
      [2, "600002"],
    ]);
    assert.deepEqual(first.page, {
      offset: 0,
      limit: 2,
      returned: 2,
      total: 3,
      hasMore: true,
      nextOffset: 2,
    });

    const second = await reader.getStrategyCandidates({
      strategyId: "alpha",
      date: "2026-02-10",
      limit: 2,
      offset: first.page.nextOffset,
    });
    assert.deepEqual(second.candidates.map((item) => [item.rank, item.code]), [[3, "600003"]]);
    assert.equal(second.page.hasMore, false);
    assert.equal(second.page.nextOffset, null);
  } finally {
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("readonly SQLite SignalReader reports not_built without manufacturing candidates", async () => {
  const fixture = createSignalDatabase();
  try {
    const reader = new ReadonlySqliteSignalReader({ databasePath: fixture.databasePath });
    const result = await reader.getStrategyCandidates({ strategyId: "missing" });
    assert.equal(result.status, "not_built");
    assert.equal(result.build, null);
    assert.deepEqual(result.candidates, []);
    assert.equal(result.page.total, 0);
  } finally {
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("readonly SQLite SignalReader fails closed when the signal database does not exist", async () => {
  const databasePath = path.join(os.tmpdir(), `missing-x-signal-${Date.now()}.db`);
  const reader = new ReadonlySqliteSignalReader({ databasePath });
  await assert.rejects(
    () => reader.getStrategyCandidates({ strategyId: "alpha" }),
    (error) => error.code === "signal_store_unavailable"
  );
  assert.equal(fs.existsSync(databasePath), false);
});

test("GetStrategyCandidatesUseCase keeps evidence opt-in and delegates normalized paging to SignalReader", async () => {
  const calls = [];
  const useCase = new GetStrategyCandidatesUseCase({
    signalReader: {
      async getStrategyCandidates(input) {
        calls.push(input);
        return {
          status: "ready",
          strategyId: input.strategyId,
          date: input.date,
          build: {
            id: "b1",
            strategyVersion: 1,
            dataVersion: "v1",
            algorithmVersion: 8,
            status: "ready",
            signalCount: 1,
          },
          candidates: [{
            rank: 1,
            securityKey: "1.600001",
            code: "600001",
            market: 1,
            rankingValues: [1, Number.NaN],
            qualityIssues: ["b", "a", "a"],
            evidence: { matched: true },
          }],
          page: { offset: input.offset, limit: input.limit, returned: 1, total: 1, hasMore: false, nextOffset: null },
          source: { kind: "fake", readonly: true },
        };
      },
    },
  });

  const compact = await useCase.execute({
    strategyId: " alpha ",
    date: "20260210",
    limit: 10,
  });
  assert.deepEqual(calls[0], {
    strategyId: "alpha",
    date: "2026-02-10",
    limit: 10,
    offset: 0,
  });
  assert.equal(compact.candidates[0].evidence, undefined);
  assert.deepEqual(compact.candidates[0].rankingValues, [1, null]);
  assert.deepEqual(compact.candidates[0].qualityIssues, ["a", "b"]);

  const detailed = await useCase.execute({
    strategyId: "alpha",
    date: "2026-02-10",
    includeEvidence: true,
  });
  assert.deepEqual(detailed.candidates[0].evidence, { matched: true });
});
