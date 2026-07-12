"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const Database = require("better-sqlite3");
const { migrations } = require("../src/simulator/adapters/sqlite/migrate");
const { SimulatorRepository } = require("../src/simulator/adapters/sqlite/repository");

function session(version = 1) {
  return { clock: { currentDate: "2026-07-01" }, id: "session-1", mode: "manual", status: "waiting_for_decision", version };
}

test("empty database initializes every migration and core table", (t) => {
  const repository = new SimulatorRepository({ db: new Database(":memory:") });
  t.after(() => repository.close());
  assert.deepEqual(repository.versions, [1, 2]);
  const tables = repository.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name);
  for (const table of ["sessions", "candidate_snapshots", "candidate_aliases", "orders", "fills", "positions", "account_snapshots", "events"]) {
    assert.equal(tables.includes(table), true, table);
  }
});

test("migration runner upgrades a version-one database", (t) => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  migrations[0].up(db);
  db.prepare("INSERT INTO schema_migrations (version) VALUES (1)").run();
  const repository = new SimulatorRepository({ db });
  t.after(() => repository.close());
  assert.deepEqual(repository.versions, [1, 2]);
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_orders_session_date'").get().name, "idx_orders_session_date");
});

test("repository persists sessions with optimistic version updates", (t) => {
  const repository = new SimulatorRepository({ db: new Database(":memory:") });
  t.after(() => repository.close());
  repository.saveSession(session(), { config: { dataMode: "legacy_approximate" } });
  assert.equal(repository.getSession("session-1").version, 1);
  assert.equal(repository.updateSessionVersion("session-1", 0, { currentDate: "2026-07-02", status: "running", version: 2 }), false);
  assert.equal(repository.updateSessionVersion("session-1", 1, { currentDate: "2026-07-02", status: "running", version: 2 }), true);
  assert.equal(repository.getSession("session-1").version, 2);
});

test("orders, fills, snapshots and events commit together and roll back together", (t) => {
  const repository = new SimulatorRepository({ db: new Database(":memory:") });
  t.after(() => repository.close());
  repository.saveSession(session());
  const order = { candidateId: "cand_a", id: "order-1", quantity: 100, reason: "练习", side: "buy", status: "accepted", tradingDate: "2026-07-01" };
  repository.transaction(() => {
    repository.saveOrder("session-1", order);
    repository.saveFill("session-1", { fees: { total: 5 }, id: "fill-1", orderId: order.id, price: 10.01, quantity: 100 });
    repository.saveAccountSnapshot("session-1", "2026-07-02", { cash: 98994, equity: 99995, frozenCash: 0, marketValue: 1001 });
    repository.appendEvent("session-1", { payload: {}, sequence: 1, type: "OrderFilled" });
  });
  assert.equal(repository.listOrders("session-1").length, 1);
  assert.equal(repository.db.prepare("SELECT price_cents FROM fills").get().price_cents, 1001);
  assert.throws(() => repository.transaction(() => {
    repository.appendEvent("session-1", { payload: {}, sequence: 2, type: "one" });
    repository.appendEvent("session-1", { payload: {}, sequence: 2, type: "duplicate" });
  }));
  assert.equal(repository.db.prepare("SELECT count(*) AS count FROM events WHERE sequence = 2").get().count, 0);
});
