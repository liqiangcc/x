"use strict";

module.exports = {
  version: 4,
  up(db) {
    db.exec(`
      ALTER TABLE strategies ADD COLUMN status TEXT NOT NULL DEFAULT 'draft';
      ALTER TABLE strategies ADD COLUMN data_version TEXT;
      ALTER TABLE strategies ADD COLUMN failure_reason TEXT;
      CREATE TABLE strategy_builds (
        id TEXT PRIMARY KEY,
        strategy_id TEXT NOT NULL REFERENCES strategies(id),
        strategy_version INTEGER NOT NULL,
        data_version TEXT NOT NULL,
        status TEXT NOT NULL,
        phase TEXT NOT NULL,
        completed INTEGER NOT NULL DEFAULT 0,
        total INTEGER NOT NULL DEFAULT 0,
        signal_count INTEGER NOT NULL DEFAULT 0,
        failure_reason TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE strategy_signals (
        build_id TEXT NOT NULL REFERENCES strategy_builds(id) ON DELETE CASCADE,
        strategy_id TEXT NOT NULL,
        strategy_version INTEGER NOT NULL,
        data_version TEXT NOT NULL,
        trading_date TEXT NOT NULL,
        security_key TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (build_id, trading_date, security_key)
      );
      CREATE INDEX idx_strategy_signals_lookup ON strategy_signals(strategy_id, strategy_version, data_version, trading_date);
    `);
  },
};
