"use strict";

const {
  createSqliteDatabase,
} = require("../adapters/database/sqlite_database");

const sqliteDatabase = createSqliteDatabase();

function initDatabase(options) {
  return sqliteDatabase.initialize(options);
}

function queryDatabase(options) {
  return sqliteDatabase.execute(options);
}

module.exports = {
  initDatabase,
  queryDatabase,
};
