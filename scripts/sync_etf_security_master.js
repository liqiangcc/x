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
  SyncEtfSecurityMasterUseCase,
} = require("../src/application/market/sync_etf_security_master");
const {
  createSecurityExecutionProfileResolver,
} = require("../src/simulation/execution/security_execution_profile_resolver");

function usage() {
  return [
    "Usage:",
    "  node scripts/sync_etf_security_master.js --exchange sse|szse --all-snapshot FILE --t0-snapshot FILE [--data-root data]",
    "",
    "Snapshot contract:",
    "  { complete: true, records: [...], source: { document, version, collectedAt } }",
    "",
    "Both snapshots must represent complete official exchange datasets. The source.document URL must belong to the selected exchange domain.",
  ].join("\n");
}

function parseArgs(argv) {
  const options = { dataRoot: "data" };
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

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(path.resolve(filePath), "utf8"));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
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
    securityMasterWriter: new LedgerSecurityMasterWriter({ dataRoot: options.dataRoot }),
    securityExecutionProfileResolver: createSecurityExecutionProfileResolver(),
  });
  const result = await useCase.execute();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
