#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const {
  probeOfficialExportBuffer,
} = require("../src/sources/exchange/official_export_probe");

function usage() {
  return [
    "Usage:",
    "  node scripts/probe_official_etf_export.js --input FILE [--require-supported]",
    "",
    "Reads a locally captured official exchange export and reports byte signature, SHA-256,",
    "current transport compatibility, parsed format, and the next parser action if unsupported.",
    "",
    "The probe does not infer ETF/T+0 eligibility and does not write Security Master data.",
  ].join("\n");
}

function parseArgs(argv) {
  const options = { requireSupported: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") return { help: true };
    if (arg === "--require-supported") {
      options.requireSupported = true;
      continue;
    }
    if (arg === "--input") {
      const value = argv[index + 1];
      if (!value) throw new Error("Missing value for --input");
      options.input = value;
      index += 1;
      continue;
    }
    throw new Error(`Unexpected argument: ${arg}`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!options.input) throw new Error("--input is required.");

  const filePath = path.resolve(options.input);
  const buffer = await fs.readFile(filePath);
  const result = probeOfficialExportBuffer(buffer, { fileName: path.basename(filePath) });
  process.stdout.write(`${JSON.stringify({ filePath, ...result }, null, 2)}\n`);

  if (options.requireSupported && !result.transportSupported) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
