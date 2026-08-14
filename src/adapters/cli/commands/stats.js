"use strict";

const {
  QueryNewHighsUseCase,
  QueryYearlyPositiveUseCase,
} = require("../../../application/stats/statistics_queries");
const { createSqliteDatabase } = require("../../database/sqlite_database");

const BOOLEAN_OPTIONS = Object.freeze(new Set([
  "latest",
  "commit",
  "force",
  "forcePool",
  "forceUniverse",
  "forceStrategyCodes",
  "strategyOnly",
  "allCodes",
  "json",
  "allowPartial",
  "proxyPreflight",
  "noProxyPreflight",
]));

function parseStatsOptions(argv, defaults = {}) {
  const options = { _: [], ...defaults };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      options._.push(arg);
      continue;
    }

    const key = arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    if (BOOLEAN_OPTIONS.has(key)) {
      options[key] = true;
      continue;
    }

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
