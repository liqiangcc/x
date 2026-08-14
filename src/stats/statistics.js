"use strict";

const { createSqliteDatabase } = require("../adapters/database/sqlite_database");
const {
  QueryNewHighsUseCase,
  QueryYearlyPositiveUseCase,
} = require("../application/stats/statistics_queries");

function yearlyPositivePct({ dbFile = "mydb.db", metricColumn, stockCode = null } = {}) {
  const useCase = new QueryYearlyPositiveUseCase({
    sqlExecutor: createSqliteDatabase(),
  });
  return useCase.execute({ dbFile, metricColumn, stockCode });
}

function analyzeNewHighs({ dbFile = "mydb.db", year = null, date = null } = {}) {
  const useCase = new QueryNewHighsUseCase({
    sqlExecutor: createSqliteDatabase(),
  });
  return useCase.execute({ dbFile, year, date });
}

module.exports = {
  analyzeNewHighs,
  yearlyPositivePct,
};
