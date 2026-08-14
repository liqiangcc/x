"use strict";

const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");
const test = require("node:test");
const {
  createSqliteDatabase,
} = require("../src/adapters/database/sqlite_database");
const {
  analyzeNewHighs,
  yearlyPositivePct,
} = require("../src/stats/statistics");

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(__dirname, "..");
const BIN = path.join(ROOT, "bin", "x");

async function runCli(args) {
  return execFileAsync(process.execPath, [BIN, ...args], {
    cwd: ROOT,
    maxBuffer: 1024 * 1024,
  });
}

function withoutSqliteExperimentalWarning(stderr) {
  return String(stderr ?? "")
    .split("\n")
    .filter(
      (line) =>
        !/^\(node:\d+\) ExperimentalWarning: SQLite is an experimental feature and might change at any time$/.test(
          line
        ) &&
        line !== "(Use `node --trace-warnings ...` to show where the warning was created)"
    )
    .join("\n");
}

async function createStatsFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "x-stats-cli-"));
  const dbFile = path.join(root, "stats.db");
  const schemaFile = path.join(root, "schema.sql");
  await fs.writeFile(
    schemaFile,
    [
      "CREATE TABLE py (c1 TEXT NOT NULL, c4 REAL NOT NULL, c12 TEXT NOT NULL);",
      "CREATE TABLE pd_xg (c1 TEXT NOT NULL, c12 TEXT NOT NULL, c3 REAL NOT NULL, c13 REAL NOT NULL);",
      "",
    ].join("\n"),
    "utf8"
  );

  const database = createSqliteDatabase();
  database.initialize({ dbFile, schemaFile });
  for (const [c1, c4, c12] of [
    ["20230101", 10, "A"],
    ["20230102", 11, "A"],
    ["20240101", 12, "A"],
  ]) {
    database.execute({
      dbFile,
      params: [c1, c4, c12],
      sql: "INSERT INTO py(c1, c4, c12) VALUES (?, ?, ?)",
    });
  }
  for (const [c1, c12, c3, c13] of [
    ["20240101", "A", 9, 10],
    ["20240102", "A", 11, 10],
    ["20240103", "A", 12, 10],
    ["20240101", "B", 8, 10],
    ["20240102", "B", 9, 10],
  ]) {
    database.execute({
      dbFile,
      params: [c1, c12, c3, c13],
      sql: "INSERT INTO pd_xg(c1, c12, c3, c13) VALUES (?, ?, ?, ?)",
    });
  }
  return { dbFile, root };
}

test("bin/x stats returns real rows for CTE-based statistics queries", async () => {
  const fixture = await createStatsFixture();
  try {
    const yearly = await runCli([
      "stats",
      "yearly-positive",
      "--metric-column",
      "c4",
      "--stock-code",
      "A",
      "--db",
      fixture.dbFile,
    ]);
    assert.equal(withoutSqliteExperimentalWarning(yearly.stderr), "");
    const yearlyRows = JSON.parse(yearly.stdout);
    assert.deepEqual(yearlyRows.map((row) => row.Year), ["2023", "2024"]);
    assert.deepEqual(yearlyRows.map((row) => row.PositivePercentage), ["100.00%", "100.00%"]);

    const newHighs = await runCli([
      "stats",
      "new-highs",
      "--date",
      "20240102",
      "--db",
      fixture.dbFile,
    ]);
    assert.equal(withoutSqliteExperimentalWarning(newHighs.stderr), "");
    const breakoutRows = JSON.parse(newHighs.stdout);
    assert.equal(breakoutRows.length, 1);
    assert.equal(breakoutRows[0].StockCode, "A");
    assert.equal(breakoutRows[0].Price, 11);
    assert.equal(breakoutRows[0].PctAboveHigh, "10.00%");
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test("legacy statistics facade keeps its public API while returning rows", async () => {
  const fixture = await createStatsFixture();
  try {
    const yearlyRows = yearlyPositivePct({
      dbFile: fixture.dbFile,
      metricColumn: "c4",
      stockCode: "A",
    });
    assert.equal(yearlyRows.length, 2);

    const breakoutRows = analyzeNewHighs({
      dbFile: fixture.dbFile,
      date: "20240102",
    });
    assert.equal(breakoutRows.length, 1);
    assert.equal(breakoutRows[0].StockCode, "A");
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});
