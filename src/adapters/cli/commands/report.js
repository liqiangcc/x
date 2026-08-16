"use strict";

const path = require("node:path");
const { parseCliOptions } = require("../option_parser");

function normalizeReportDate(input) {
  const digits = String(input).replace(/-/g, "");
  if (!/^\d{8}$/.test(digits)) {
    throw new Error(`Invalid date: ${input}`);
  }
  return digits;
}

function requireReportGenerator(value) {
  if (typeof value !== "function") {
    throw new TypeError("daily report generator must be a function.");
  }
  return value;
}

async function runReportCommand({
  argv = [],
  generateReport,
  createReportGenerator,
  klineDir,
  outputDir,
  poolDir,
  root,
  stdout = process.stdout,
} = {}) {
  const subcommand = argv[0];
  if (subcommand !== "daily") {
    throw new Error(`Unknown report command: ${subcommand ?? ""}`);
  }

  const options = parseCliOptions(argv.slice(1));
  if (!options.date) {
    throw new Error("report daily requires --date <YYYYMMDD>");
  }

  const date = normalizeReportDate(options.date);
  const resolvedGenerateReport = requireReportGenerator(
    generateReport ?? createReportGenerator?.(),
  );
  const report = await resolvedGenerateReport({
    date,
    klineDir,
    outputDir,
    poolDir,
  });
  const reportPath = path.relative(root, report.reportDir).replaceAll(path.sep, "/");
  stdout.write(`${reportPath}\n`);
  return { date, report, reportPath, subcommand };
}

function createReportCommand({
  root,
  klineDir,
  outputDir = path.join(root, "reports"),
  poolDir,
  stdout = process.stdout,
  generateReport,
} = {}) {
  const createReportGenerator = () => {
    if (generateReport) {
      return generateReport;
    }
    const { generateDailyReport } = require("../../../reports/daily");
    return generateDailyReport;
  };

  return (argv = []) => runReportCommand({
    argv,
    createReportGenerator,
    klineDir,
    outputDir,
    poolDir,
    root,
    stdout,
  });
}

module.exports = {
  createReportCommand,
  normalizeReportDate,
  runReportCommand,
};
