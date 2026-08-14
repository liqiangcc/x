"use strict";

const {
  ExecuteDatabaseSqlUseCase,
  InitializeDatabaseUseCase,
} = require("../../../application/database/database_commands");
const { createSqliteDatabase } = require("../../database/sqlite_database");

function parseDbOptions(argv, defaults = {}) {
  const options = { _: [], ...defaults };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      options._.push(arg);
      continue;
    }

    const key = arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const nextArg = argv[index + 1];
    if (!nextArg) {
      throw new Error(`Missing value for ${arg}`);
    }
    options[key] = nextArg;
    index += 1;
  }
  return options;
}

function writeJson(stdout, payload) {
  stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

async function runDbCommand({
  argv = [],
  initializeDatabaseUseCase,
  executeDatabaseSqlUseCase,
  stdout = process.stdout,
} = {}) {
  if (!initializeDatabaseUseCase || typeof initializeDatabaseUseCase.execute !== "function") {
    throw new TypeError("initializeDatabaseUseCase must expose execute().");
  }
  if (!executeDatabaseSqlUseCase || typeof executeDatabaseSqlUseCase.execute !== "function") {
    throw new TypeError("executeDatabaseSqlUseCase must expose execute().");
  }

  const subcommand = argv[0];
  const options = parseDbOptions(argv.slice(1), {
    db: "db/stocks.db",
    schema: "db/database_schema.sql",
  });

  if (subcommand === "init") {
    const result = await initializeDatabaseUseCase.execute({
      dbFile: options.db,
      schemaFile: options.schema,
    });
    writeJson(stdout, result);
    return result;
  }

  if (subcommand === "query") {
    if (!options.sql) {
      throw new Error("db query requires --sql <sql>");
    }
    const result = await executeDatabaseSqlUseCase.execute({
      dbFile: options.db,
      sql: options.sql,
    });
    writeJson(stdout, result);
    return result;
  }

  throw new Error(`Unknown db command: ${subcommand ?? ""}`);
}

function createDbCommand({
  databaseAdapter,
  databaseInitializer,
  sqlExecutor,
  stdout = process.stdout,
  initializeDatabaseUseCase,
  executeDatabaseSqlUseCase,
} = {}) {
  let sharedAdapter = databaseAdapter;
  const getSharedAdapter = () => {
    sharedAdapter ??= createSqliteDatabase();
    return sharedAdapter;
  };

  const resolvedInitializeUseCase = initializeDatabaseUseCase ?? new InitializeDatabaseUseCase({
    databaseInitializer: databaseInitializer ?? getSharedAdapter(),
  });
  const resolvedExecuteUseCase = executeDatabaseSqlUseCase ?? new ExecuteDatabaseSqlUseCase({
    sqlExecutor: sqlExecutor ?? getSharedAdapter(),
  });

  return (argv) => runDbCommand({
    argv,
    executeDatabaseSqlUseCase: resolvedExecuteUseCase,
    initializeDatabaseUseCase: resolvedInitializeUseCase,
    stdout,
  });
}

module.exports = {
  createDbCommand,
  parseDbOptions,
  runDbCommand,
};
