"use strict";

const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");
const test = require("node:test");

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(__dirname, "..");
const BIN = path.join(ROOT, "bin", "x");

async function runCli(args) {
  return execFileAsync(process.execPath, [BIN, ...args], {
    cwd: ROOT,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
    maxBuffer: 1024 * 1024,
  });
}

test("bin/x db init and query preserve the SQLite CLI contract", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "x-cli-db-"));
  const dbFile = path.join(root, "nested", "test.db");
  const schemaFile = path.join(root, "schema.sql");
  try {
    await fs.writeFile(
      schemaFile,
      "CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT NOT NULL);\n",
      "utf8"
    );

    const initialized = await runCli([
      "db", "init",
      "--db", dbFile,
      "--schema", schemaFile,
    ]);
    assert.deepEqual(JSON.parse(initialized.stdout), { dbFile, schemaFile });

    const written = await runCli([
      "db", "query",
      "--db", dbFile,
      "--sql", "INSERT INTO items(value) VALUES ('alpha')",
    ]);
    assert.deepEqual(JSON.parse(written.stdout), []);

    const selected = await runCli([
      "db", "query",
      "--db", dbFile,
      "--sql", "SELECT id, value FROM items ORDER BY id",
    ]);
    const rows = JSON.parse(selected.stdout);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].value, "alpha");
    assert.equal(typeof rows[0].id, "number");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
