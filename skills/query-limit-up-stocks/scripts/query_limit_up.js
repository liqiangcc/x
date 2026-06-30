#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");

function printUsage() {
  console.error(
    "Usage: node scripts/query_limit_up.js <YYYYMMDD> [--base-dir <dir>] [--json] [--limit <N>] [--sort <code|name|price|change_pct|sector|streak_days|open_count|event_time>]"
  );
}

function parseArguments(argv) {
  const options = {
    baseDir: path.resolve("data/pool"),
    date: null,
    json: false,
    limit: null,
    sort: "event_time",
  };

  const validSorts = new Set(["code", "name", "price", "change_pct", "sector", "streak_days", "open_count", "event_time"]);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--base-dir") {
      const nextArg = argv[index + 1];
      if (!nextArg) {
        throw new Error("Missing value for --base-dir.");
      }
      options.baseDir = path.resolve(nextArg);
      index += 1;
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--limit") {
      const nextArg = argv[index + 1];
      if (!nextArg || !/^\d+$/.test(nextArg) || Number(nextArg) < 1) {
        throw new Error(`Invalid value for --limit: ${nextArg ?? ""}`);
      }
      options.limit = Number(nextArg);
      index += 1;
      continue;
    }

    if (arg === "--sort") {
      const nextArg = argv[index + 1];
      if (!nextArg || !validSorts.has(nextArg)) {
        throw new Error(`Invalid value for --sort: ${nextArg ?? ""}`);
      }
      options.sort = nextArg;
      index += 1;
      continue;
    }

    if (options.date) {
      throw new Error("Only one date is supported.");
    }

    options.date = arg;
  }

  if (!options.date || !/^\d{8}$/.test(options.date)) {
    printUsage();
    throw new Error("A trading date in YYYYMMDD format is required.");
  }

  return options;
}

function normalizePrice(value) {
  return typeof value === "number" ? value / 1000 : null;
}

function normalizeTime(value) {
  if (typeof value !== "number") {
    return null;
  }

  const padded = String(value).padStart(6, "0");
  return `${padded.slice(0, 2)}:${padded.slice(2, 4)}:${padded.slice(4, 6)}`;
}

function pickEventTime(item) {
  for (const key of ["fbt", "lbt", "yfbt"]) {
    if (typeof item[key] === "number") {
      return normalizeTime(item[key]);
    }
  }
  return null;
}

function compareValues(left, right, sortKey) {
  const leftValue = left[sortKey];
  const rightValue = right[sortKey];

  if (sortKey === "event_time") {
    return String(leftValue ?? "").localeCompare(String(rightValue ?? ""));
  }

  if (typeof leftValue === "number" || typeof rightValue === "number") {
    return Number(rightValue ?? -Infinity) - Number(leftValue ?? -Infinity);
  }

  return String(leftValue ?? "").localeCompare(String(rightValue ?? ""));
}

function toRecord(item, qdate) {
  return {
    qdate,
    code: item.c ?? null,
    name: item.n ?? null,
    price: normalizePrice(item.p),
    limit_up_price: normalizePrice(item.ztp),
    change_pct: item.zdp ?? null,
    sector: item.hybk ?? null,
    streak_days: item?.zttj?.days ?? item.days ?? null,
    streak_count: item?.zttj?.ct ?? null,
    open_count: item.oc ?? 0,
    board_count: item.zbc ?? null,
    event_time: pickEventTime(item),
  };
}

function formatValue(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  return String(value);
}

function renderTable(records) {
  const columns = [
    ["code", "Code"],
    ["name", "Name"],
    ["price", "Price"],
    ["change_pct", "Chg%"],
    ["sector", "Sector"],
    ["streak_days", "Streak"],
    ["open_count", "Open"],
    ["event_time", "Time"],
  ];

  const widths = columns.map(([key, label]) =>
    Math.max(label.length, ...records.map((record) => formatValue(record[key]).length))
  );

  const lines = [];
  lines.push(
    columns
      .map(([, label], index) => label.padEnd(widths[index]))
      .join("  ")
  );
  lines.push(widths.map((width) => "-".repeat(width)).join("  "));

  for (const record of records) {
    lines.push(
      columns
        .map(([key], index) => formatValue(record[key]).padEnd(widths[index]))
        .join("  ")
    );
  }

  return lines.join("\n");
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const filePath = path.join(options.baseDir, options.date, "zt.json");
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  const qdate = parsed?.data?.qdate ?? options.date;
  const pool = Array.isArray(parsed?.data?.pool) ? parsed.data.pool : [];

  const records = pool.map((item) => toRecord(item, qdate)).sort((left, right) => compareValues(left, right, options.sort));
  const selected = options.limit ? records.slice(0, options.limit) : records;

  const output = {
    input_file: filePath,
    qdate,
    total_records: records.length,
    returned_records: selected.length,
    records: selected,
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }

  console.log(`Date: ${qdate}`);
  console.log(`Input: ${filePath}`);
  console.log(`Total limit-up stocks: ${records.length}`);
  if (selected.length === 0) {
    return;
  }
  console.log("");
  console.log(renderTable(selected));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
