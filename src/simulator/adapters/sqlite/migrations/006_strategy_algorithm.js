"use strict";

module.exports = {
  version: 6,
  up(db) {
    db.exec("ALTER TABLE strategy_builds ADD COLUMN algorithm_version INTEGER NOT NULL DEFAULT 1");
  },
};
