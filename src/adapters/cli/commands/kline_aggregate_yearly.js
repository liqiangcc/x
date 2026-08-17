"use strict";

const path = require("node:path");
const { parseCliOptions } = require("../option_parser");

function parsePositiveIntegerOption(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function requireFunction(value, message) {
  if (typeof value !== "function") {
    throw new TypeError(message);
  }
  return value;
}

async function runKlineAggregateYearlyCommand({
  argv = [],
  readCodesInput,
  aggregateYearly,
  resolveReadCodesInput,
  resolveAggregateYearly,
  klineRoot,
  stdout = process.stdout,
  setExitCode = (exitCode) => {
    process.exitCode = exitCode;
  },
} = {}) {
  const options = parseCliOptions(argv, { concurrency: "16" });
  const inputPath = options._[0];
  if (!inputPath) {
    throw new Error("kline aggregate-yearly requires <input_dir|codes.json>.");
  }
  if (!options.date) {
    throw new Error("kline aggregate-yearly requires --date YYYYMMDD.");
  }

  const readCodes = requireFunction(
    readCodesInput ?? resolveReadCodesInput?.(),
    "kline aggregate-yearly codes input reader must be a function.",
  );
  const aggregate = requireFunction(
    aggregateYearly ?? resolveAggregateYearly?.(),
    "kline aggregate-yearly capability must be a function.",
  );

  const codes = await readCodes(inputPath);
  const concurrency = parsePositiveIntegerOption(options.concurrency, 16);
  const result = await aggregate({
    codes,
    concurrency,
    klineRoot,
    targetDate: options.date,
  });

  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.failed > 0) {
    setExitCode(1);
  }
  return {
    concurrency,
    inputPath,
    result,
  };
}

function createKlineAggregateYearlyCommand({
  root,
  klineRoot = root ? path.join(root, "data", "kline") : undefined,
  readCodesInput,
  aggregateYearly,
  createCodesInputReader,
  stdout = process.stdout,
  setExitCode = (exitCode) => {
    process.exitCode = exitCode;
  },
} = {}) {
  let defaultReader;
  let defaultAggregate;

  function resolveReadCodesInput() {
    if (readCodesInput) return readCodesInput;
    if (createCodesInputReader) {
      defaultReader ??= createCodesInputReader({ root });
      return defaultReader;
    }
    const {
      createFilesystemKlineCodesInputReader,
    } = require("../../kline/kline_codes_input_reader");
    defaultReader ??= createFilesystemKlineCodesInputReader({ root });
    return defaultReader;
  }

  function resolveAggregateYearly() {
    if (aggregateYearly) return aggregateYearly;
    defaultAggregate ??= require("../../../kline/aggregate_yearly").aggregateYearlyFromDaily;
    return defaultAggregate;
  }

  return (argv = []) => runKlineAggregateYearlyCommand({
    argv,
    resolveReadCodesInput,
    resolveAggregateYearly,
    klineRoot,
    stdout,
    setExitCode,
  });
}

module.exports = {
  createKlineAggregateYearlyCommand,
  parsePositiveIntegerOption,
  runKlineAggregateYearlyCommand,
};
