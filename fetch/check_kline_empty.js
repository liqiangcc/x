#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");

function printUsage() {
  console.error(
    "Usage: node fetch/check_kline_empty.js [target_path] [--period <daily|yearly>] [--json]"
  );
}

function parseArguments(argv) {
  const options = {
    json: false,
    period: null,
    targetPath: path.resolve("data/kline"),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--period") {
      const nextArg = argv[index + 1];
      if (!nextArg || !["daily", "yearly"].includes(nextArg)) {
        throw new Error(`Invalid value for --period: ${nextArg ?? ""}`);
      }
      options.period = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (options.targetPath !== path.resolve("data/kline")) {
      throw new Error("Only one target_path is supported.");
    }

    options.targetPath = path.resolve(arg);
  }

  return options;
}

async function walkJsonFiles(targetPath) {
  const stat = await fs.stat(targetPath);
  if (stat.isFile()) {
    return targetPath.endsWith(".json") ? [targetPath] : [];
  }

  const files = [];
  const entries = await fs.readdir(targetPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkJsonFiles(entryPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".json") && !entry.name.startsWith("summary.")) {
      files.push(entryPath);
    }
  }

  return files.sort();
}

function inspectKlinePayload(payload) {
  if (!payload || typeof payload !== "object") {
    return "invalid_payload";
  }

  const klines = getKlines(payload);

  if (!klines.exists) {
    return "missing_klines";
  }

  if (!Array.isArray(klines.value)) {
    return "invalid_klines";
  }

  if (klines.value.length === 0) {
    return "empty_klines";
  }

  if (klines.value.every((item) => typeof item === "string" && item.trim() === "")) {
    return "blank_klines";
  }

  const structuralIssue = inspectKlineRows(klines.value);
  if (structuralIssue) {
    return structuralIssue;
  }

  return null;
}

function getKlines(payload) {
  if (Object.prototype.hasOwnProperty.call(payload, "klines")) {
    return { exists: true, value: payload.klines };
  }

  if (payload.data && Object.prototype.hasOwnProperty.call(payload.data, "klines")) {
    return { exists: true, value: payload.data.klines };
  }

  return { exists: false, value: null };
}

function inspectKlineRows(rows) {
  const seenDates = new Set();
  let previousDate = null;

  for (const row of rows) {
    if (typeof row !== "string") {
      return "invalid_kline_row";
    }

    const fields = row.split(",");
    if (fields.length !== 11) {
      return "invalid_field_count";
    }

    const date = fields[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return "invalid_date";
    }

    if (previousDate && date < previousDate) {
      return "date_not_ascending";
    }
    previousDate = date;

    if (seenDates.has(date)) {
      return "duplicate_date";
    }
    seenDates.add(date);

    const open = Number(fields[1]);
    const close = Number(fields[2]);
    const high = Number(fields[3]);
    const low = Number(fields[4]);
    const volume = Number(fields[5]);
    const turnover = Number(fields[6]);

    if (![open, close, high, low, volume, turnover].every(Number.isFinite)) {
      return "invalid_numeric_field";
    }

    if (high < open || high < close || high < low || low > open || low > close || low > high) {
      return "invalid_ohlc";
    }

    if (volume < 0 || turnover < 0) {
      return "negative_volume_or_turnover";
    }
  }

  return null;
}

function inferPeriodFromPath(filePath) {
  const normalized = filePath.split(path.sep);
  if (normalized.includes("daily")) {
    return "daily";
  }
  if (normalized.includes("yearly")) {
    return "yearly";
  }
  return null;
}

async function inspectFile(filePath) {
  let raw;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    return { file: filePath, issue: "read_error", error: error.message };
  }

  if (raw.trim() === "") {
    return { file: filePath, issue: "empty_file" };
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    return { file: filePath, issue: "invalid_json", error: error.message };
  }

  const issue = inspectKlinePayload(payload);
  if (!issue) {
    return null;
  }

  return {
    file: filePath,
    issue,
    code: payload?.code ?? payload?.data?.code ?? path.basename(filePath, ".json"),
    period: inferPeriodFromPath(filePath),
  };
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    printUsage();
    throw error;
  }

  const targetPath = options.period ? path.join(options.targetPath, options.period) : options.targetPath;
  const files = await walkJsonFiles(targetPath);
  const issues = [];

  for (const filePath of files) {
    const result = await inspectFile(filePath);
    if (result) {
      issues.push(result);
    }
  }

  const summary = {
    target_path: targetPath,
    total_files: files.length,
    empty_count: issues.length,
    issue_count: issues.length,
    status: issues.length > 0 ? "failed" : "ok",
    issues,
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (issues.length > 0) {
      process.exitCode = 1;
    }
    return;
  }

  console.log(`Checked ${summary.total_files} files under ${summary.target_path}`);
  console.log(`Empty or invalid kline files: ${summary.empty_count}`);

  for (const issue of issues) {
    console.log(`${issue.issue}\t${issue.file}`);
  }

  if (issues.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
