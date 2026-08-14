"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ExecuteDatabaseSqlUseCase,
  InitializeDatabaseUseCase,
} = require("../src/application/database/database_commands");

test("InitializeDatabaseUseCase depends only on database initialization", async () => {
  const calls = [];
  const useCase = new InitializeDatabaseUseCase({
    databaseInitializer: {
      async initialize(input) {
        calls.push(input);
        return input;
      },
    },
  });

  const result = await useCase.execute({
    dbFile: "var/test.db",
    schemaFile: "db/schema.sql",
  });

  assert.deepEqual(calls, [{ dbFile: "var/test.db", schemaFile: "db/schema.sql" }]);
  assert.deepEqual(result, calls[0]);
});

test("ExecuteDatabaseSqlUseCase depends only on SQL execution", async () => {
  const calls = [];
  const useCase = new ExecuteDatabaseSqlUseCase({
    sqlExecutor: {
      async execute(input) {
        calls.push(input);
        return [{ value: 42 }];
      },
    },
  });

  const result = await useCase.execute({
    dbFile: "var/test.db",
    params: [42],
    sql: "SELECT ? AS value",
  });

  assert.deepEqual(calls, [{
    dbFile: "var/test.db",
    params: [42],
    sql: "SELECT ? AS value",
  }]);
  assert.deepEqual(result, [{ value: 42 }]);
});

test("database application contracts reject missing capabilities and invalid results", async () => {
  assert.throws(() => new InitializeDatabaseUseCase(), /databaseInitializer implementation/);
  assert.throws(() => new ExecuteDatabaseSqlUseCase(), /sqlExecutor implementation/);

  const missingSql = new ExecuteDatabaseSqlUseCase({
    sqlExecutor: { async execute() { return []; } },
  });
  await assert.rejects(() => missingSql.execute({}), /requires sql/);

  const invalidResult = new ExecuteDatabaseSqlUseCase({
    sqlExecutor: { async execute() { return { rows: [] }; } },
  });
  await assert.rejects(
    () => invalidResult.execute({ sql: "SELECT 1" }),
    /must return an array/
  );
});
