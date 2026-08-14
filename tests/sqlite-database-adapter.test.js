"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  createSqliteDatabase,
} = require("../src/adapters/database/sqlite_database");

test("sqlite database adapter initializes schema and executes read/write SQL", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "x-db-adapter-"));
  const dbFile = path.join(root, "nested", "test.db");
  const schemaFile = path.join(root, "schema.sql");
  try {
    await fs.writeFile(
      schemaFile,
      "CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT NOT NULL);\n",
      "utf8"
    );

    const database = createSqliteDatabase();
    assert.deepEqual(
      database.initialize({ dbFile, schemaFile }),
      { dbFile, schemaFile }
    );

    assert.deepEqual(
      database.execute({
        dbFile,
        params: ["alpha"],
        sql: "INSERT INTO items(value) VALUES (?)",
      }),
      []
    );

    const rows = database.execute({
      dbFile,
      params: ["alpha"],
      sql: "SELECT id, value FROM items WHERE value = ?",
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].value, "alpha");
    assert.equal(typeof rows[0].id, "number");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("sqlite database adapter keeps the legacy missing-sql error", () => {
  const database = createSqliteDatabase();
  assert.throws(
    () => database.execute({ dbFile: ":memory:" }),
    /queryDatabase requires sql/
  );
});
