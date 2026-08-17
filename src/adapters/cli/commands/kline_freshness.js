"use strict";

const path = require("node:path");
const { parseCliOptions } = require("../option_parser");

function requireFunction(value, message) {
  if (typeof value !== "function") {
    throw new TypeError(message);
  }
  return value;
}

function resolveRootPath(root, filePath) {
  if (!root) {
    throw new TypeError("kline freshness root is required.");
  }
  return path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
}

function buildSuggestedSyncCommand(repairOutput, report) {
  const expected = report.expected_latest_date.replaceAll("-", "");
  return [
    "bin/x kline sync",
    repairOutput,
    "--period", report.period,
    "--policy proxy-only",
    "--expected-latest-date", expected,
    "--freshness-codes", repairOutput,
  ].join(" ");
}

function formatKlineFreshnessText(report) {
  const lines = [
    `Kline freshness: ${report.period}`,
    `Expected latest date: ${report.expected_latest_date} (${report.expected_date_source})`,
    `Universe: ${report.universe_count}`,
    `Fresh: ${report.fresh_count}`,
    `Stale: ${report.stale_count}`,
    `Missing: ${report.missing_count}`,
    `Invalid: ${report.invalid_count}`,
    `Repair: ${report.repair_count}`,
    `Fresh rate: ${(report.fresh_rate * 100).toFixed(2)}%`,
    "Latest date distribution:",
  ];
  for (const [date, count] of Object.entries(report.latest_date_distribution)) {
    lines.push(`${date}\t${count}`);
  }
  if (report.repair_output) lines.push(`Repair codes: ${report.repair_output}`);
  if (report.suggested_sync_command) lines.push(`Sync: ${report.suggested_sync_command}`);
  return `${lines.join("\n")}\n`;
}

async function runKlineFreshnessCommand({
  argv = [],
  root,
  inspectFreshness,
  writeRepairCodes,
  resolveFreshnessModule,
  stdout = process.stdout,
} = {}) {
  const options = parseCliOptions(argv);
  if (!options.period || !["daily", "yearly"].includes(options.period)) {
    throw new Error("kline freshness requires --period daily|yearly.");
  }
  if (!options.codes) {
    throw new Error("kline freshness requires --codes <codes.json>.");
  }

  const targetRoot = resolveRootPath(root, options._[0] ?? "data/kline");
  const codesFile = resolveRootPath(root, options.codes);
  let freshnessModule;
  function getFreshnessModule() {
    freshnessModule ??= resolveFreshnessModule?.();
    return freshnessModule;
  }

  const inspect = requireFunction(
    inspectFreshness ?? getFreshnessModule()?.inspectFreshness,
    "kline freshness inspect capability must be a function.",
  );
  const report = await inspect({
    codesFile,
    expectedLatestDate: options.expectedLatestDate,
    period: options.period,
    targetRoot,
  });

  if (options.repairOutput) {
    const repairOutput = resolveRootPath(root, options.repairOutput);
    const writeRepair = requireFunction(
      writeRepairCodes ?? getFreshnessModule()?.writeRepairCodes,
      "kline freshness repair writer must be a function.",
    );
    await writeRepair(repairOutput, report);
    report.repair_output = repairOutput;
    report.suggested_sync_command = buildSuggestedSyncCommand(repairOutput, report);
  } else {
    report.repair_output = null;
    report.suggested_sync_command = null;
  }

  if (options.json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    stdout.write(formatKlineFreshnessText(report));
  }

  return {
    codesFile,
    report,
    targetRoot,
  };
}

function createKlineFreshnessCommand({
  root,
  inspectFreshness,
  writeRepairCodes,
  loadFreshnessModule,
  stdout = process.stdout,
} = {}) {
  let defaultModule;
  function resolveFreshnessModule() {
    if (defaultModule) return defaultModule;
    defaultModule = loadFreshnessModule
      ? loadFreshnessModule()
      : require("../../../kline/freshness");
    return defaultModule;
  }

  return (argv = []) => runKlineFreshnessCommand({
    argv,
    root,
    inspectFreshness,
    writeRepairCodes,
    resolveFreshnessModule,
    stdout,
  });
}

module.exports = {
  buildSuggestedSyncCommand,
  createKlineFreshnessCommand,
  formatKlineFreshnessText,
  resolveRootPath,
  runKlineFreshnessCommand,
};
