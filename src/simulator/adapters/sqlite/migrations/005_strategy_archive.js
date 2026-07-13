"use strict";

module.exports = {
  version: 5,
  up(db) {
    db.exec("ALTER TABLE strategies ADD COLUMN archived INTEGER NOT NULL DEFAULT 0");
  },
};
