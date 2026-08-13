#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const {
  OfficialExchangeEtfSource,
} = require("../src/sources/exchange/official_etf_source");
const {
  LedgerSecurityMasterWriter,
} = require("../src/adapters/ledger/ledger_security_master_writer");
const {
  DryRunSecurityMasterWriter,
} = require("../src/adapters/market/dry_run_security_master_writer");
const {
  SyncEtfSecurityMasterUseCase,
} = require("../src/application/market/sync_etf_security_master");
const {
  createSecurityExecutionProfileResolver,
} = require("../src/simulation/execution/security_execution_profile_resolver");

function usage() {
  return [
    "Usage:",
    "  node scripts/sync_etf_security_master.js --exchange sse|szse --all-snapshot FILE --t0-snapshot FILE [--data-root data] [--dry-run]",
    "",
    "Snapshot contract:",
    "  { complete: true, records: [...], source: { document, version, collectedAt } }",
    "",
    "Both snapshots must represent complete official exchange datasets. The source.document URL must belong to the selected exchange domain.",
    "--dry-run executes the same Source -> Quality Gate -> Writer flow but records write intents only; it never mutates data/security_master.",
  ].join("\n");
}

function parseArgs(argv) {
  const options = { dataRoot: "data", dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") return { help: true };
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    const key = arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    options[key] = value;
    index += 1;
  }
  return options;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(path.resolve(filePath), "utf8"));
}

function createSecurityMasterWriter(options) {
  return options.dryRun
    ? new DryRunSecurityMasterWriter()
    : new LedgerSecurityMasterWriter({ dataRoot: options.dataRoot });
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return null;
  }
  for (const key of ["exchange", "allSnapshot", "t0Snapshot"]) {
    if (!options[key]) throw new Error(`--${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)} is required.`);
  }

  const source = new OfficialExchangeEtfSource({
    exchange: options.exchange,
    fetchAllEtfs: () => readJson(options.allSnapshot),
    fetchT0Etfs: () => readJson(options.t0Snapshot),
  });
  const useCase = new SyncEtfSecurityMasterUseCase({
    sources: [source],
    securityMasterWriter: createSecurityMasterWriter(options),
    securityExecutionProfileResolver: createSecurityExecutionProfileResolver(),
  });
  const result = await useCase.execute();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
  return result;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  createSecurityMasterWriter,
  main,
  parseArgs,
  readJson,
  usage,
};
