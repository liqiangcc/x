"use strict";

const fs = require("node:fs");
const path = require("node:path");

function loadSqlite() {
  try {
    return require("node:sqlite");
  } catch {
    throw new Error("SQLite commands require Node.js 22+ with node:sqlite support.");
  }
}

function openDatabase(dbFile) {
  const { DatabaseSync } = loadSqlite();
  return new DatabaseSync(dbFile);
}

function initDatabase({ dbFile = "db/stocks.db", schemaFile = "db/database_schema.sql" } = {}) {
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const schema = fs.readFileSync(schemaFile, "utf8");
  const database = openDatabase(dbFile);
  try {
    database.exec(schema);
  } finally {
    database.close();
  }
  return { dbFile, schemaFile };
}

function queryDatabase({ dbFile = "db/stocks.db", sql, params = [] }) {
  if (!sql || typeof sql !== "string") {
    throw new Error("queryDatabase requires sql.");
  }
  const database = openDatabase(dbFile);
  try {
    const statement = database.prepare(sql);
    if (/^\s*select\b/i.test(sql)) {
      return statement.all(...params);
    }
    statement.run(...params);
    return [];
  } finally {
    database.close();
  }
}

module.exports = {
  initDatabase,
  queryDatabase,
};
