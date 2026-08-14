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

function assertSql(sql) {
  if (!sql || typeof sql !== "string") {
    throw new Error("queryDatabase requires sql.");
  }
  return sql;
}

function createSqliteDatabase() {
  return {
    initialize({ dbFile = "db/stocks.db", schemaFile = "db/database_schema.sql" } = {}) {
      fs.mkdirSync(path.dirname(dbFile), { recursive: true });
      const schema = fs.readFileSync(schemaFile, "utf8");
      const database = openDatabase(dbFile);
      try {
        database.exec(schema);
      } finally {
        database.close();
      }
      return { dbFile, schemaFile };
    },

    execute({ dbFile = "db/stocks.db", sql, params = [] } = {}) {
      assertSql(sql);
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
    },

    queryRows({ dbFile = "db/stocks.db", sql, params = [] } = {}) {
      assertSql(sql);
      const database = openDatabase(dbFile);
      try {
        return database.prepare(sql).all(...params);
      } finally {
        database.close();
      }
    },
  };
}

module.exports = {
  createSqliteDatabase,
};
