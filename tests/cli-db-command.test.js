"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createDbCommand,
  parseDbOptions,
  runDbCommand,
} = require("../src/adapters/cli/commands/db");

function captureWriter() {
  let text = "";
  return {
    stream: {
      write(chunk) {
        text += String(chunk);
      },
    },
    value() {
      return text;
    },
  };
}

test("db init maps CLI options to Application and prints JSON", async () => {
  const output = captureWriter();
  const calls = [];
  const result = await runDbCommand({
    argv: ["init", "--db", "var/test.db", "--schema", "db/schema.sql"],
    initializeDatabaseUseCase: {
      async execute(input) {
        calls.push(input);
        return input;
      },
    },
    executeDatabaseSqlUseCase: { async execute() { return []; } },
    stdout: output.stream,
  });

  assert.deepEqual(calls, [{ dbFile: "var/test.db", schemaFile: "db/schema.sql" }]);
  assert.deepEqual(result, calls[0]);
  assert.equal(
    output.value(),
    `${JSON.stringify(calls[0], null, 2)}\n`
  );
});

test("db query preserves SQL execution and JSON output contract", async () => {
  const output = captureWriter();
  const calls = [];
  const result = await runDbCommand({
    argv: ["query", "--sql", "UPDATE items SET value = 'x'", "--db", "var/test.db"],
    initializeDatabaseUseCase: { async execute() { return {}; } },
    executeDatabaseSqlUseCase: {
      async execute(input) {
        calls.push(input);
        return [];
      },
    },
    stdout: output.stream,
  });

  assert.deepEqual(calls, [{
    dbFile: "var/test.db",
    sql: "UPDATE items SET value = 'x'",
  }]);
  assert.deepEqual(result, []);
  assert.equal(output.value(), "[]\n");
});

test("db CLI preserves defaults, missing SQL error, and legacy boolean parsing", async () => {
  assert.deepEqual(
    parseDbOptions(["--json", "--db", "custom.db"], {
      db: "db/stocks.db",
      schema: "db/database_schema.sql",
    }),
    {
      _: [],
      db: "custom.db",
      schema: "db/database_schema.sql",
      json: true,
    }
  );

  await assert.rejects(
    () => runDbCommand({
      argv: ["query"],
      initializeDatabaseUseCase: { async execute() { return {}; } },
      executeDatabaseSqlUseCase: { async execute() { return []; } },
    }),
    /db query requires --sql <sql>/
  );
});

test("createDbCommand accepts explicit use cases without requiring SQLite wiring", async () => {
  const output = captureWriter();
  const command = createDbCommand({
    initializeDatabaseUseCase: {
      async execute(input) {
        return input;
      },
    },
    executeDatabaseSqlUseCase: { async execute() { return []; } },
    stdout: output.stream,
  });

  await command(["init"]);
  assert.match(output.value(), /db\/stocks\.db/);
  assert.match(output.value(), /db\/database_schema\.sql/);
});
