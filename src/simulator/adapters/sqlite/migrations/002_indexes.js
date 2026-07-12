"use strict";

module.exports = {
  version: 2,
  up(db) {
    db.exec(`
      CREATE INDEX idx_orders_session_date ON orders(session_id, trading_date);
      CREATE INDEX idx_fills_session_order ON fills(session_id, order_id);
      CREATE INDEX idx_snapshots_session_date ON candidate_snapshots(session_id, as_of_date);
      CREATE INDEX idx_account_session_date ON account_snapshots(session_id, trading_date);
    `);
  },
};
