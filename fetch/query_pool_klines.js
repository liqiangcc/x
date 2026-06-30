#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const FETCH_KLINE_SCRIPT = path.resolve(__dirname, "./fetch_kline.js");
const VALID_ENGINES = new Set(["auto", "local", "aws"]);
const PERIODS = new Set(["daily", "yearly"]);

function printUsage() {
  console.error(
    "Usage: node fetch/query_pool_klines.js <input_path> [--period <daily|yearly>] [--engine <auto|local|aws>] [--aws-region <r1,r2,...>] [--lambda-name <name>] [--config <file>] [--output-dir <dir>] [--limit <N>] [--force]"
  );
}

function parseArguments(argv) {
  const options = {
    awsRegions: null,
    configFile: null,
    engine: "auto",
    force: false,
    inputPath: null,
    lambdaName: "kline",
    limit: null,
    outputDir: path.resolve("data/kline"),
    period: "daily",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--period") {
      const nextArg = argv[index + 1];
      if (!nextArg || !PERIODS.has(nextArg)) {
        throw new Error(`Invalid value for --period: ${nextArg ?? ""}`);
      }
      options.period = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--engine") {
      const nextArg = argv[index + 1];
      if (!nextArg || !VALID_ENGINES.has(nextArg)) {
        throw new Error(`Invalid value for --engine: ${nextArg ?? ""}`);
      }
      options.engine = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--aws-region") {
      const nextArg = argv[index + 1];
      if (!nextArg) {
        throw new Error("Missing value for --aws-region.");
      }
      options.awsRegions = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--lambda-name") {
      const nextArg = argv[index + 1];
      if (!nextArg) {
        throw new Error("Missing value for --lambda-name.");
      }
      options.lambdaName = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--config") {
      const nextArg = argv[index + 1];
      if (!nextArg) {
        throw new Error("Missing value for --config.");
      }
      options.configFile = path.resolve(nextArg);
      index += 1;
      continue;
    }

    if (arg === "--output-dir") {
      const nextArg = argv[index + 1];
      if (!nextArg) {
        throw new Error("Missing value for --output-dir.");
      }
      options.outputDir = path.resolve(nextArg);
      index += 1;
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

    if (arg === "--force") {
      options.force = true;
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

  return options;
}

function uniqueCodes(codes) {
  return [...new Set(codes.filter(Boolean))].sort();
}

async function extractCodesFromPoolDir(dirPath) {
  const codesFile = path.join(dirPath, "codes.json");
  try {
    const raw = await fs.readFile(codesFile, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.codes)) {
      return uniqueCodes(parsed.codes);
    }
  } catch {}

  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const jsonFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && entry.name !== "summary.json" && entry.name !== "codes.json")
    .map((entry) => path.join(dirPath, entry.name))
    .sort();

  const codes = [];
  for (const filePath of jsonFiles) {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    const pool = Array.isArray(parsed?.data?.pool) ? parsed.data.pool : [];
    for (const item of pool) {
      if (item?.c) {
        codes.push(item.c);
      }
    }
  }

  return uniqueCodes(codes);
}

async function loadCodes(inputPath) {
  const stats = await fs.stat(inputPath);
  if (stats.isDirectory()) {
    return extractCodesFromPoolDir(inputPath);
  }

  const raw = await fs.readFile(inputPath, "utf8");

  if (inputPath.endsWith(".json")) {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return uniqueCodes(parsed);
    }
    if (Array.isArray(parsed?.codes)) {
      return uniqueCodes(parsed.codes);
    }
  }

  return uniqueCodes(
    raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
  );
}

function inferSecid(code) {
  if (/^\d+\.[A-Za-z0-9]+$/.test(code)) {
    return code;
  }
  if (/^6\d{5}$/.test(code)) {
    return `1.${code}`;
  }
  if (/^[03]\d{5}$/.test(code)) {
    return `0.${code}`;
  }
  if (/^9\d{5}$/.test(code)) {
    return `0.${code}`;
  }
  throw new Error(`Unable to infer market for code: ${code}`);
}

async function fetchSingleKline(secid, options) {
  const args = [FETCH_KLINE_SCRIPT, secid, "--period", options.period, "--engine", options.engine];

  if (options.awsRegions) {
    args.push("--aws-region", options.awsRegions);
  }

  if (options.lambdaName) {
    args.push("--lambda-name", options.lambdaName);
  }

  if (options.configFile) {
    args.push("--config", options.configFile);
  }

  const { stdout } = await execFileAsync("node", args, {
    maxBuffer: 25 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options) {
    return;
  }

  const codes = await loadCodes(options.inputPath);
  const selectedCodes = options.limit ? codes.slice(0, options.limit) : codes;
  const periodDir = path.join(options.outputDir, options.period);
  await fs.mkdir(periodDir, { recursive: true });

  const summary = {
    aws_regions: options.awsRegions,
    engine: options.engine,
    input_path: options.inputPath,
    lambda_name: options.lambdaName,
    period: options.period,
    total_codes: selectedCodes.length,
    success: 0,
    skipped_existing: 0,
    failed: 0,
    files: {},
  };

  for (const code of selectedCodes) {
    const secid = inferSecid(code);
    const outputPath = path.join(periodDir, `${code}.json`);

    if (!options.force) {
      try {
        await fs.access(outputPath);
        summary.files[code] = {
          status: "skipped_existing",
          file: outputPath,
          secid,
        };
        summary.skipped_existing += 1;
        continue;
      } catch {}
    }

    try {
      const data = await fetchSingleKline(secid, options);
      await fs.writeFile(outputPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
      summary.files[code] = {
        engine: data.source_engine ?? options.engine,
        region: data.source_region ?? null,
        status: "success",
        file: outputPath,
        secid,
        points: Array.isArray(data?.data?.klines) ? data.data.klines.length : 0,
      };
      summary.success += 1;
    } catch (error) {
      summary.files[code] = {
        status: "failed",
        secid,
        error: error.message,
      };
      summary.failed += 1;
    }
  }

  const summaryPath = path.join(periodDir, `summary.${options.period}.json`);
  await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(summaryPath);

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
