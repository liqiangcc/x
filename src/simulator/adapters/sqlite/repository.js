"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");
const { migrate } = require("./migrate");

const DEFAULT_DATABASE_PATH = path.join("var", "simulator", "simulator.db");

function json(value) {
  return JSON.stringify(value ?? null);
}

function parse(value) {
  return value === null || value === undefined ? null : JSON.parse(value);
}

function cents(value) {
  return Math.round(Number(value) * 100);
}

class SimulatorRepository {
  constructor({ databasePath = DEFAULT_DATABASE_PATH, db } = {}) {
    if (db) {
      this.db = db;
    } else {
      fs.mkdirSync(path.dirname(databasePath), { recursive: true });
      this.db = new Database(databasePath);
    }
    this.db.pragma("foreign_keys = ON");
    this.versions = migrate(this.db);
  }

  close() {
    this.db.close();
  }

  transaction(work) {
    return this.db.transaction(work)();
  }

  saveSession(session, { config = {}, state = session } = {}) {
    this.db.prepare(`
      INSERT INTO sessions (id, status, mode, current_date, version, config_json, state_json)
      VALUES (@id, @status, @mode, @currentDate, @version, @config, @state)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status, mode = excluded.mode, current_date = excluded.current_date,
        version = excluded.version, config_json = excluded.config_json, state_json = excluded.state_json,
        updated_at = CURRENT_TIMESTAMP
    `).run({
      config: json(config),
      currentDate: session.clock?.currentDate ?? session.currentDate,
      id: session.id,
      mode: session.mode,
      state: json(state),
      status: session.status,
      version: session.version,
    });
  }

  getSession(id) {
    const row = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
    if (!row) return null;
    return {
      config: parse(row.config_json),
      currentDate: row.current_date,
      id: row.id,
      mode: row.mode,
      state: parse(row.state_json),
      status: row.status,
      version: row.version,
    };
  }

  updateSessionVersion(id, expectedVersion, patch) {
    const result = this.db.prepare(`
      UPDATE sessions SET status = @status, current_date = @currentDate, version = @nextVersion,
        state_json = @state, updated_at = CURRENT_TIMESTAMP
      WHERE id = @id AND version = @expectedVersion
    `).run({
      currentDate: patch.currentDate,
      expectedVersion,
      id,
      nextVersion: patch.version,
      state: json(patch.state ?? patch),
      status: patch.status,
    });
    return result.changes === 1;
  }

  saveCandidateSnapshot({ aliases = [], candidates = [], snapshot }) {
    this.db.prepare(`INSERT INTO candidate_snapshots
      (id, session_id, as_of_date, data_version, selection_config_hash, payload_json)
      VALUES (?, ?, ?, ?, ?, ?)`
    ).run(snapshot.id, snapshot.sessionId, snapshot.asOfDate, snapshot.dataVersion, snapshot.selectionConfigHash, json(snapshot));
    const candidateStatement = this.db.prepare(`INSERT INTO candidates
      (snapshot_id, candidate_id, rank, evidence_json, quality_json) VALUES (?, ?, ?, ?, ?)`);
    for (const candidate of candidates) {
      candidateStatement.run(snapshot.id, candidate.candidateId, candidate.rank, json(candidate.evidence), json(candidate.qualityIssues ?? []));
    }
    const aliasStatement = this.db.prepare(`INSERT INTO candidate_aliases
      (session_id, candidate_id, alias, security_json) VALUES (?, ?, ?, ?)`);
    for (const alias of aliases) aliasStatement.run(snapshot.sessionId, alias.candidateId, alias.alias, json(alias.security));
  }

  saveLineage({ branchDate, configHash, parentSessionId, sessionId }) {
    this.db.prepare(`INSERT INTO session_lineage
      (session_id, parent_session_id, branch_date, config_hash) VALUES (?, ?, ?, ?)`
    ).run(sessionId, parentSessionId, branchDate, configHash);
  }

  saveOrder(sessionId, order) {
    this.db.prepare(`INSERT INTO orders
      (id, session_id, candidate_id, trading_date, side, quantity, reason, status, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET quantity=excluded.quantity, reason=excluded.reason,
        status=excluded.status, payload_json=excluded.payload_json`
    ).run(order.id, sessionId, order.candidateId, order.tradingDate, order.side, order.quantity, order.reason, order.status, json(order));
  }

  listOrders(sessionId) {
    return this.db.prepare("SELECT payload_json FROM orders WHERE session_id = ? ORDER BY rowid").all(sessionId).map((row) => parse(row.payload_json));
  }

  saveFill(sessionId, fill) {
    this.db.prepare(`INSERT INTO fills
      (id, session_id, order_id, price_cents, quantity, fee_cents, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(fill.id, sessionId, fill.orderId, cents(fill.price), fill.quantity, cents(fill.fees.total), json(fill));
  }

  replacePositions(sessionId, positions) {
    this.db.prepare("DELETE FROM positions WHERE session_id = ?").run(sessionId);
    const statement = this.db.prepare(`INSERT INTO positions
      (session_id, candidate_id, quantity, available_quantity, average_cost_cents, payload_json)
      VALUES (?, ?, ?, ?, ?, ?)`);
    for (const position of positions) {
      statement.run(sessionId, position.candidateId, position.quantity, position.availableQuantity, cents(position.averageCost), json(position));
    }
  }

  saveAccountSnapshot(sessionId, tradingDate, snapshot) {
    this.db.prepare(`INSERT INTO account_snapshots
      (session_id, trading_date, cash_cents, frozen_cash_cents, market_value_cents, equity_cents, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, trading_date) DO UPDATE SET cash_cents=excluded.cash_cents,
        frozen_cash_cents=excluded.frozen_cash_cents, market_value_cents=excluded.market_value_cents,
        equity_cents=excluded.equity_cents, payload_json=excluded.payload_json`
    ).run(sessionId, tradingDate, cents(snapshot.cash), cents(snapshot.frozenCash), cents(snapshot.marketValue), cents(snapshot.equity), json(snapshot));
  }

  appendEvent(sessionId, event) {
    this.db.prepare("INSERT INTO events (session_id, sequence, type, payload_json) VALUES (?, ?, ?, ?)")
      .run(sessionId, event.sequence, event.type, json(event.payload));
  }
}

module.exports = {
  DEFAULT_DATABASE_PATH,
  SimulatorRepository,
  cents,
  json,
  parse,
};
