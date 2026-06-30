#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const PARSE_POOL_SCRIPT = path.resolve(__dirname, "./parse_pool_json.js");

function printUsage() {
  console.error(
    "Usage: node utils/generate_pool_codes_batch.js [pool_root_dir] [--force]"
  );
}

function parseArguments(argv) {
  const options = {
    force: false,
    rootDir: path.resolve("data/pool"),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--force") {
      options.force = true;
      continue;
    }

    if (options.rootDir !== path.resolve("data/pool")) {
      throw new Error("Only one pool_root_dir is supported.");
    }

    options.rootDir = path.resolve(arg);
  }

  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const entries = await fs.readdir(options.rootDir, { withFileTypes: true });
  const dateDirs = entries
    .filter((entry) => entry.isDirectory() && /^\d{8}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  const summary = {
    input_root: options.rootDir,
    total_dates: dateDirs.length,
    generated: 0,
    skipped_existing: 0,
    failed: 0,
    dates: [],
  };

  for (const date of dateDirs) {
    const dirPath = path.join(options.rootDir, date);
    const codesPath = path.join(dirPath, "codes.json");

    if (!options.force) {
      try {
        await fs.access(codesPath);
        summary.skipped_existing += 1;
        summary.dates.push({
          date,
          status: "skipped_existing",
          file: codesPath,
        });
        continue;
      } catch {}
    }

    try {
      const { stdout } = await execFileAsync(
        "node",
        [PARSE_POOL_SCRIPT, dirPath, "--codes-only"],
        { maxBuffer: 10 * 1024 * 1024 }
      );

      summary.generated += 1;
      summary.dates.push({
        date,
        status: "generated",
        file: stdout.trim() || codesPath,
      });
    } catch (error) {
      summary.failed += 1;
      summary.dates.push({
        date,
        status: "failed",
        error: error.message,
      });
    }
  }

  console.log(JSON.stringify(summary, null, 2));

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  printUsage();
  console.error(error.message);
  process.exit(1);
});
