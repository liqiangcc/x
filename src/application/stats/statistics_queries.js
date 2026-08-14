"use strict";

const { assertSqlExecutor } = require("../../ports/database/sql_database");
const {
  buildNewHighsQuery,
  buildYearlyPositiveQuery,
} = require("../../stats/queries");

function assertRows(value, operation) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${operation} must return an array.`);
  }
  return value;
}

class QueryYearlyPositiveUseCase {
  constructor({ sqlExecutor } = {}) {
    this.sqlExecutor = assertSqlExecutor(sqlExecutor);
  }

  execute({ dbFile, metricColumn, stockCode = null } = {}) {
    const query = buildYearlyPositiveQuery({ metricColumn, stockCode });
    return assertRows(
      this.sqlExecutor.execute({ dbFile, ...query }),
      "sqlExecutor.execute()"
    );
  }
}

class QueryNewHighsUseCase {
  constructor({ sqlExecutor } = {}) {
    this.sqlExecutor = assertSqlExecutor(sqlExecutor);
  }

  execute({ dbFile, year = null, date = null } = {}) {
    const query = buildNewHighsQuery({ year, date });
    return assertRows(
      this.sqlExecutor.execute({ dbFile, ...query }),
      "sqlExecutor.execute()"
    );
  }
}

module.exports = {
  QueryNewHighsUseCase,
  QueryYearlyPositiveUseCase,
};
