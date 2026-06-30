#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");

const KNOWN_POOLS = new Set(["dt", "qs", "zb", "zt"]);

function printUsage() {
  console.error(
    "Usage: node utils/parse_pool_json.js <input_path> [--output <file>] [--pool <dt|qs|zb|zt>] [--fields code,name,...] [--flat] [--codes-only]"
  );
}

function parseArguments(argv) {
  const options = {
    codesOnly: false,
    fields: null,
    flat: false,
    inputPath: null,
    inputIsDirectory: false,
    outputFile: null,
    pool: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--output" || arg === "-o") {
      const nextArg = argv[index + 1];
      if (!nextArg) {
        throw new Error("Missing value for --output.");
      }

      options.outputFile = path.resolve(nextArg);
      index += 1;
      continue;
    }

    if (arg === "--pool") {
      const nextArg = argv[index + 1];
      if (!nextArg) {
        throw new Error("Missing value for --pool.");
      }
      if (!KNOWN_POOLS.has(nextArg)) {
        throw new Error(`Invalid pool: ${nextArg}`);
      }

      options.pool = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--fields") {
      const nextArg = argv[index + 1];
      if (!nextArg) {
        throw new Error("Missing value for --fields.");
      }

      const fields = nextArg
        .split(",")
        .map((field) => field.trim())
        .filter(Boolean);
      if (fields.length === 0) {
        throw new Error("No valid fields were provided to --fields.");
      }

      options.fields = fields;
      index += 1;
      continue;
    }

    if (arg === "--flat") {
      options.flat = true;
      continue;
    }

    if (arg === "--codes-only") {
      options.codesOnly = true;
      continue;
    }

    if (options.inputPath) {
      throw new Error("Only one input_path is supported.");
    }

    options.inputPath = path.resolve(arg);
  }

  if (!options.inputPath) {
    printUsage();
    process.exitCode = 1;
    return null;
  }

  if (options.codesOnly && !options.flat) {
    options.flat = true;
  }

  if (options.codesOnly && !options.fields) {
    options.fields = ["code"];
  }

  return options;
}

function pickFields(record, fields) {
  const selected = {};
  for (const field of fields) {
    selected[field] = Object.prototype.hasOwnProperty.call(record, field) ? record[field] : null;
  }
  return selected;
}

function marketName(marketId) {
  if (marketId === 0) {
    return "sz";
  }
  if (marketId === 1) {
    return "sh";
  }
  return String(marketId ?? "");
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
      return {
        event_time_field: key,
        event_time_raw: item[key],
        event_time: normalizeTime(item[key]),
      };
    }
  }

  return {
    event_time_field: null,
    event_time_raw: null,
    event_time: null,
  };
}

function detectPoolType(filePath, explicitPool) {
  if (explicitPool) {
    return explicitPool;
  }

  const basename = path.basename(filePath, ".json");
  if (KNOWN_POOLS.has(basename)) {
    return basename;
  }

  throw new Error(`Unable to detect pool type from filename: ${filePath}`);
}

function normalizeRecord(item, poolType, qdate) {
  const eventTime = pickEventTime(item);
  const streakDays =
    item?.zttj && typeof item.zttj.days === "number" ? item.zttj.days : typeof item.days === "number" ? item.days : null;
  const streakCount = item?.zttj && typeof item.zttj.ct === "number" ? item.zttj.ct : null;

  return {
    pool_type: poolType,
    qdate,
    code: item.c ?? null,
    secid: item.c && item.m !== undefined ? `${item.m}.${item.c}` : null,
    market_id: item.m ?? null,
    market: marketName(item.m),
    name: item.n ?? null,
    price: normalizePrice(item.p),
    price_raw: item.p ?? null,
    limit_up_price: normalizePrice(item.ztp),
    limit_up_price_raw: item.ztp ?? null,
    change_pct: item.zdp ?? null,
    amount: item.amount ?? null,
    turnover_rate: item.hs ?? null,
    amplitude_pct: item.zf ?? null,
    sector: item.hybk ?? null,
    streak_days: streakDays,
    streak_count: streakCount,
    board_count: item.zbc ?? null,
    open_count: item.oc ?? null,
    limit_break_times: item.lb ?? null,
    net_change: item.zs ?? null,
    limit_flag: item.ztf ?? null,
    event_time_field: eventTime.event_time_field,
    event_time_raw: eventTime.event_time_raw,
    event_time: eventTime.event_time,
  };
}

async function parsePoolFile(filePath, explicitPool, fields) {
  const rawText = await fs.readFile(filePath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    throw new Error(`Failed to parse JSON file ${filePath}: ${error.message}`);
  }

  const poolType = detectPoolType(filePath, explicitPool);
  const qdate = parsed?.data?.qdate ?? null;
  const items = Array.isArray(parsed?.data?.pool) ? parsed.data.pool : [];
  const records = items.map((item) => {
    const normalized = normalizeRecord(item, poolType, qdate);
    return fields ? pickFields(normalized, fields) : normalized;
  });

  return {
    file: filePath,
    fields: fields ?? null,
    pool_type: poolType,
    qdate,
    rc: parsed?.rc ?? null,
    total_count: records.length,
    records,
  };
}

async function collectJsonFiles(inputPath) {
  const stats = await fs.stat(inputPath);
  if (stats.isFile()) {
    return { files: [inputPath], isDirectory: false };
  }

  if (!stats.isDirectory()) {
    throw new Error(`Unsupported input path: ${inputPath}`);
  }

  const entries = await fs.readdir(inputPath, { withFileTypes: true });
  return {
    isDirectory: true,
    files: entries
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name.endsWith(".json") &&
          entry.name !== "summary.json" &&
          entry.name !== "codes.json"
      )
      .map((entry) => path.join(inputPath, entry.name))
      .sort(),
  };
}

function deriveDefaultOutputPath(options) {
  if (options.outputFile) {
    return options.outputFile;
  }

  if (options.codesOnly && options.inputIsDirectory) {
    return path.join(options.inputPath, "codes.json");
  }

  return null;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options) {
    return;
  }

  const { files, isDirectory } = await collectJsonFiles(options.inputPath);
  options.inputIsDirectory = isDirectory;
  if (files.length === 0) {
    throw new Error("No pool JSON files found.");
  }

  const parsedFiles = [];
  for (const filePath of files) {
    parsedFiles.push(await parsePoolFile(filePath, options.pool, options.fields));
  }

  const flatRecords = parsedFiles.flatMap((file) => file.records);
  let output;

  if (options.codesOnly) {
    const codes = [...new Set(flatRecords.map((record) => record.code).filter(Boolean))].sort();
    output = {
      fields: ["code"],
      input_path: options.inputPath,
      file_count: parsedFiles.length,
      total_records: flatRecords.length,
      total_codes: codes.length,
      codes,
    };
  } else if (options.flat) {
    output = {
      fields: options.fields ?? null,
      input_path: options.inputPath,
      file_count: parsedFiles.length,
      total_records: flatRecords.length,
      records: flatRecords,
    };
  } else {
    output = {
      fields: options.fields ?? null,
      input_path: options.inputPath,
      file_count: parsedFiles.length,
      total_records: parsedFiles.reduce((sum, file) => sum + file.total_count, 0),
      files: parsedFiles,
    };
  }

  const outputText = `${JSON.stringify(output, null, 2)}\n`;
  const outputPath = deriveDefaultOutputPath(options);
  if (outputPath) {
    await fs.writeFile(outputPath, outputText, "utf8");
    console.log(outputPath);
    return;
  }

  process.stdout.write(outputText);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
