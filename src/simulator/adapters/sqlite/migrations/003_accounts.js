"use strict";

module.exports = {
  version: 3,
  up(db) {
    db.exec(`
      CREATE TABLE strategies (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        is_system INTEGER NOT NULL DEFAULT 0,
        config_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE account_profiles (
        account_id TEXT PRIMARY KEY REFERENCES sessions(id),
        name TEXT NOT NULL,
        start_mode TEXT NOT NULL CHECK (start_mode IN ('random','specified')),
        requested_start_date TEXT,
        actual_start_date TEXT NOT NULL,
        calculated_date TEXT,
        strategy_id TEXT REFERENCES strategies(id),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE account_watchlist (
        account_id TEXT NOT NULL REFERENCES sessions(id),
        candidate_id TEXT NOT NULL,
        alias TEXT NOT NULL,
        security_json TEXT NOT NULL,
        added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (account_id, candidate_id)
      );
      CREATE TABLE candidate_calculations (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES sessions(id),
        strategy_id TEXT NOT NULL REFERENCES strategies(id),
        trading_date TEXT NOT NULL,
        status TEXT NOT NULL,
        result_count INTEGER NOT NULL DEFAULT 0,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_candidate_calculations_account_date ON candidate_calculations(account_id, trading_date);
    `);
  },
};
