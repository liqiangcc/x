"use strict";

module.exports = {
  version: 7,
  up(db) {
    db.exec(`
      ALTER TABLE account_watchlist ADD COLUMN strategy_id TEXT;
      ALTER TABLE account_watchlist ADD COLUMN signal_date TEXT;
      ALTER TABLE account_watchlist ADD COLUMN signal_close REAL;
      ALTER TABLE account_watchlist ADD COLUMN evidence_json TEXT;
      ALTER TABLE account_watchlist ADD COLUMN signal_source TEXT;
    `);
  },
};
