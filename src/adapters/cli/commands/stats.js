"use strict";

const {
  QueryNewHighsUseCase,
  QueryYearlyPositiveUseCase,
} = require("../../../application/stats/statistics_queries");
const { createSqliteDatabase } = require("../../database/sqlite_database");
const { parseCliOptions } = require("../options");

function parseStatsOptions(argv, defaults = {}) {
  return parseCliOptions(argv, { defaults });
}

function writeJson(stdout, payload) {
  stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

async function runStatsCommand({
  argv = [],
  yearlyPositiveUseCase,
  newHighsUseCase,
  stdout = process.stdout,
} = {}) {
  if (!yearlyPositiveUseCase || typeof yearlyPositiveUseCase.execute !== "function") {
    throw new TypeError("yearlyPositiveUseCase must expose execute().");
  }
  if (!newHighsUseCase || typeof newHighsUseCase.execute !== "function") {
    throw new TypeError("newHighsUseCase must expose execute().");
  }

  const subcommand = argv[0];
  const options = parseStatsOptions(argv.slice(1), { db: "mydb.db" });

  if (subcommand === "yearly-positive") {
    if (!options.metricColumn) {
      throw new Error("stats yearly-positive requires --metric-column <column>");
    }
    const result = await yearlyPositiveUseCase.execute({
      dbFile: options.db,
      metricColumn: options.metricColumn,
      stockCode: options.stockCode ?? null,
    });
    writeJson(stdout, result);
    return result;
  }

  if (subcommand === "new-highs") {
    const result = await newHighsUseCase.execute({
      dbFile: options.db,
      year: options.year ?? null,
      date: options.date ?? null,
    });
    writeJson(stdout, result);
    return result;
  }

  throw new Error(`Unknown stats command: ${subcommand ?? ""}`);
}

function createStatsCommand({
  sqlRowReader,
  stdout = process.stdout,
  yearlyPositiveUseCase,
  newHighsUseCase,
} = {}) {
  let sharedRowReader = sqlRowReader;
  const getSqlRowReader = () => {
    sharedRowReader ??= createSqliteDatabase();
    return sharedRowReader;
  };

  const resolvedYearlyPositiveUseCase = yearlyPositiveUseCase ?? new QueryYearlyPositiveUseCase({
    sqlRowReader: getSqlRowReader(),
  });
  const resolvedNewHighsUseCase = newHighsUseCase ?? new QueryNewHighsUseCase({
    sqlRowReader: getSqlRowReader(),
  });

  return (argv) => runStatsCommand({
    argv,
    yearlyPositiveUseCase: resolvedYearlyPositiveUseCase,
    newHighsUseCase: resolvedNewHighsUseCase,
    stdout,
  });
}

module.exports = {
  createStatsCommand,
  parseStatsOptions,
  runStatsCommand,
};
