#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const {
  OfficialExportFileTransport,
} = require("../src/sources/exchange/official_export_file_transport");

function usage() {
  return [
    "Usage:",
    "  node scripts/capture_official_etf_snapshot.js \\",
    "    --exchange sse|szse \\",
    "    --dataset all_etfs|t0_etfs \\",
    "    --input FILE \\",
    "    --document OFFICIAL_HTTPS_URL \\",
    "    --version VERSION \\",
    "    --collected-at ISO_DATETIME \\",
    "    --expected-record-count N \\",
    "    [--expected-content-hash SHA256] \\",
    "    [--output FILE]",
    "",
    "The input must be a complete official export represented as JSON, UTF-8 CSV/TSV, or an HTML table.",
    "Binary XLS/XLSX files are rejected until a dedicated verified parser is added.",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") return { help: true };
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
    const value = argv[index + 1];
    if (!value) throw new Error(`Missing value for ${arg}`);
    const key = arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    options[key] = value;
    index += 1;
  }
  return options;
}

async function writeOutput(filePath, payload) {
  const text = `${JSON.stringify(payload, null, 2)}\n`;
  if (!filePath) {
    process.stdout.write(text);
    return;
  }
  const resolved = path.resolve(filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, text, "utf8");
  process.stdout.write(`${resolved}\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  for (const key of [
    "exchange",
    "dataset",
    "input",
    "document",
    "version",
    "collectedAt",
    "expectedRecordCount",
  ]) {
    if (!options[key]) {
      const flag = key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
      throw new Error(`--${flag} is required.`);
    }
  }

  const transport = new OfficialExportFileTransport({
    exchange: options.exchange,
    dataset: options.dataset,
    filePath: options.input,
    document: options.document,
    version: options.version,
    collectedAt: options.collectedAt,
    expectedRecordCount: options.expectedRecordCount,
    expectedContentHash: options.expectedContentHash ?? null,
  });
  const snapshot = await transport.readSnapshot();
  await writeOutput(options.output, snapshot);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
