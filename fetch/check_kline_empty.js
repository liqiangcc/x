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

  if (!payload.data || typeof payload.data !== "object") {
    return "missing_data";
  }

  if (!Object.prototype.hasOwnProperty.call(payload.data, "klines")) {
    return "missing_klines";
  }

  if (!Array.isArray(payload.data.klines)) {
    return "invalid_klines";
  }

  if (payload.data.klines.length === 0) {
    return "empty_klines";
  }

  if (payload.data.klines.every((item) => typeof item === "string" && item.trim() === "")) {
    return "blank_klines";
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
    code: payload?.data?.code ?? path.basename(filePath, ".json"),
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
    issues,
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
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
