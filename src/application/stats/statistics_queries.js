"use strict";

const { assertSqlRowReader } = require("../../ports/database/sql_database");
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
  constructor({ sqlRowReader } = {}) {
    this.sqlRowReader = assertSqlRowReader(sqlRowReader);
  }

  execute({ dbFile, metricColumn, stockCode = null } = {}) {
    const query = buildYearlyPositiveQuery({ metricColumn, stockCode });
    return assertRows(
      this.sqlRowReader.queryRows({ dbFile, ...query }),
      "sqlRowReader.queryRows()"
    );
  }
}

class QueryNewHighsUseCase {
  constructor({ sqlRowReader } = {}) {
    this.sqlRowReader = assertSqlRowReader(sqlRowReader);
  }

  execute({ dbFile, year = null, date = null } = {}) {
    const query = buildNewHighsQuery({ year, date });
    return assertRows(
      this.sqlRowReader.queryRows({ dbFile, ...query }),
      "sqlRowReader.queryRows()"
    );
  }
}

module.exports = {
  QueryNewHighsUseCase,
  QueryYearlyPositiveUseCase,
};
