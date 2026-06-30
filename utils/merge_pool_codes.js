#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");

const POOL_FILES = ["dt.json", "qs.json", "zb.json", "zt.json"];

function printUsage() {
  console.error(
    "Usage: node utils/merge_pool_codes.js [pool_root_dir] [--output <file>]"
  );
}

function parseArguments(argv) {
  const options = {
    outputFile: path.resolve("data/pool/all_codes.json"),
    rootDir: path.resolve("data/pool"),
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

    if (options.rootDir !== path.resolve("data/pool")) {
      throw new Error("Only one pool_root_dir is supported.");
    }

    options.rootDir = path.resolve(arg);
  }

  return options;
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

async function readCodesJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed?.codes)) {
    throw new Error(`Invalid codes.json format: ${filePath}`);
  }
  return parsed.codes;
}

async function readCodesFromPoolFile(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  const pool = Array.isArray(parsed?.data?.pool) ? parsed.data.pool : [];
  return pool.map((item) => item?.c).filter(Boolean);
}

async function collectCodesForDateDir(dateDirPath) {
  const codesJsonPath = path.join(dateDirPath, "codes.json");

  try {
    const codes = await readCodesJson(codesJsonPath);
    return {
      codes,
      source: "codes.json",
    };
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  const collected = [];
  for (const fileName of POOL_FILES) {
    const filePath = path.join(dateDirPath, fileName);
    try {
      const codes = await readCodesFromPoolFile(filePath);
      collected.push(...codes);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }

  return {
    codes: uniqueSorted(collected),
    source: "pool_json",
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const entries = await fs.readdir(options.rootDir, { withFileTypes: true });
  const dateDirs = entries
    .filter((entry) => entry.isDirectory() && /^\d{8}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  const mergedCodes = new Set();
  const dates = [];

  for (const date of dateDirs) {
    const dirPath = path.join(options.rootDir, date);
    const result = await collectCodesForDateDir(dirPath);
    const uniqueCodes = uniqueSorted(result.codes);

    for (const code of uniqueCodes) {
      mergedCodes.add(code);
    }

    dates.push({
      date,
      code_count: uniqueCodes.length,
      source: result.source,
    });
  }

  const output = {
    input_root: options.rootDir,
    date_count: dates.length,
    total_codes: mergedCodes.size,
    dates,
    codes: [...mergedCodes].sort(),
  };

  await fs.mkdir(path.dirname(options.outputFile), { recursive: true });
  await fs.writeFile(options.outputFile, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(options.outputFile);
}

main().catch((error) => {
  printUsage();
  console.error(error.message);
  process.exit(1);
});
