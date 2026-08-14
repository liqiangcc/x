"use strict";

const {
  assertDatabaseInitializer,
  assertSqlExecutor,
} = require("../../ports/database/sql_database");

class InitializeDatabaseUseCase {
  constructor({ databaseInitializer } = {}) {
    this.databaseInitializer = assertDatabaseInitializer(databaseInitializer);
  }

  async execute({ dbFile, schemaFile } = {}) {
    return this.databaseInitializer.initialize({ dbFile, schemaFile });
  }
}

class ExecuteDatabaseSqlUseCase {
  constructor({ sqlExecutor } = {}) {
    this.sqlExecutor = assertSqlExecutor(sqlExecutor);
  }

  async execute({ dbFile, sql, params = [] } = {}) {
    if (!sql || typeof sql !== "string") {
      throw new Error("execute database sql requires sql.");
    }
    const result = await this.sqlExecutor.execute({ dbFile, params, sql });
    if (!Array.isArray(result)) {
      throw new TypeError("sqlExecutor.execute() must return an array.");
    }
    return result;
  }
}

module.exports = {
  ExecuteDatabaseSqlUseCase,
  InitializeDatabaseUseCase,
};
