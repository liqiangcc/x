"use strict";

module.exports = {
  version: 1,
  up(db) {
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK (status IN ('created','waiting_for_decision','running','completed','cancelled','failed')),
        mode TEXT NOT NULL,
        current_date TEXT NOT NULL,
        version INTEGER NOT NULL,
        config_json TEXT NOT NULL,
        state_json TEXT NOT NULL,
        revealed_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE session_lineage (
        session_id TEXT PRIMARY KEY REFERENCES sessions(id),
        parent_session_id TEXT REFERENCES sessions(id),
        branch_date TEXT NOT NULL,
        config_hash TEXT NOT NULL
      );
      CREATE TABLE session_data_versions (
        session_id TEXT NOT NULL REFERENCES sessions(id),
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        PRIMARY KEY (session_id, name)
      );
      CREATE TABLE selection_presets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        config_json TEXT NOT NULL
      );
      CREATE TABLE candidate_snapshots (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        as_of_date TEXT NOT NULL,
        data_version TEXT NOT NULL,
        selection_config_hash TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        UNIQUE (as_of_date, data_version, selection_config_hash)
      );
      CREATE TABLE candidates (
        snapshot_id TEXT NOT NULL REFERENCES candidate_snapshots(id),
        candidate_id TEXT NOT NULL,
        rank INTEGER,
        evidence_json TEXT NOT NULL,
        quality_json TEXT NOT NULL,
        PRIMARY KEY (snapshot_id, candidate_id)
      );
      CREATE TABLE candidate_aliases (
        session_id TEXT NOT NULL REFERENCES sessions(id),
        candidate_id TEXT NOT NULL,
        alias TEXT NOT NULL,
        security_json TEXT NOT NULL,
        PRIMARY KEY (session_id, candidate_id),
        UNIQUE (session_id, alias)
      );
      CREATE TABLE orders (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        candidate_id TEXT NOT NULL,
        trading_date TEXT NOT NULL,
        side TEXT NOT NULL CHECK (side IN ('buy','sell')),
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
        status TEXT NOT NULL CHECK (status IN ('submitted','accepted','rejected','filled','cancelled','expired')),
        payload_json TEXT NOT NULL
      );
      CREATE TABLE fills (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        order_id TEXT NOT NULL REFERENCES orders(id),
        price_cents INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        fee_cents INTEGER NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE TABLE positions (
        session_id TEXT NOT NULL REFERENCES sessions(id),
        candidate_id TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        available_quantity INTEGER NOT NULL,
        average_cost_cents INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (session_id, candidate_id)
      );
      CREATE TABLE account_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        trading_date TEXT NOT NULL,
        cash_cents INTEGER NOT NULL,
        frozen_cash_cents INTEGER NOT NULL,
        market_value_cents INTEGER NOT NULL,
        equity_cents INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        UNIQUE (session_id, trading_date)
      );
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        sequence INTEGER NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (session_id, sequence)
      );
    `);
  },
};
