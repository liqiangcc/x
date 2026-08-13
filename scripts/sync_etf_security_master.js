#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const {
  OfficialExchangeEtfSource,
} = require("../src/sources/exchange/official_etf_source");
const {
  LedgerSecurityMasterReader,
} = require("../src/adapters/ledger/ledger_security_master_reader");
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
  ValidateSecurityMasterUseCase,
} = require("../src/application/market/validate_security_master");
const {
  createSecurityExecutionProfileResolver,
} = require("../src/simulation/execution/security_execution_profile_resolver");

const APPLY_GUARD_KEYS = Object.freeze([
  "expectedEtfCount",
  "expectedT0Count",
  "expectedAllContentHash",
  "expectedT0ContentHash",
]);

function usage() {
  return [
    "Usage:",
    "  node scripts/sync_etf_security_master.js --exchange sse|szse --all-snapshot FILE --t0-snapshot FILE [--data-root data] [--dry-run]",
    "  node scripts/sync_etf_security_master.js --exchange sse|szse --all-snapshot FILE --t0-snapshot FILE --apply \\",
    "    --expected-etf-count N --expected-t0-count N \\",
    "    --expected-all-content-hash SHA256 --expected-t0-content-hash SHA256 [--data-root data]",
    "",
    "Snapshot contract:",
    "  { complete: true, records: [...], source: { document, version, collectedAt, contentHash } }",
    "",
    "Default mode is dry-run. It executes Source -> Quality Gate -> Writer but records write intents only.",
    "--dry-run is an explicit alias for the default mode and never mutates data/security_master.",
    "--apply is the only mode that may persist records and requires exact count/hash guards from an accepted dry-run.",
    "After apply, the persisted ledger is read back and validated with the same Security Master Quality Gate.",
  ].join("\n");
}

function parseArgs(argv) {
  const options = { dataRoot: "data", apply: false, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") return { help: true };
    if (arg === "--dry-run") {
      if (options.apply) throw new Error("--dry-run and --apply are mutually exclusive.");
      options.dryRun = true;
      continue;
    }
    if (arg === "--apply") {
      if (options.dryRun) throw new Error("--dry-run and --apply are mutually exclusive.");
      options.apply = true;
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

function normalizeGuardCount(value, field, { positive = false } = {}) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 0 || (positive && count === 0)) {
    throw new TypeError(`${field} must be ${positive ? "a positive" : "a non-negative"} integer.`);
  }
  return count;
}

function normalizeGuardHash(value, field) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) throw new TypeError(`${field} is required for --apply.`);
  const normalized = text.startsWith("sha256:") ? text : `sha256:${text}`;
  if (!/^sha256:[0-9a-f]{64}$/.test(normalized)) {
    throw new TypeError(`${field} must be a SHA-256 digest.`);
  }
  return normalized;
}

function snapshotRecords(snapshot, field) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new TypeError(`${field} snapshot must be an object.`);
  }
  if (!Array.isArray(snapshot.records)) {
    throw new TypeError(`${field} snapshot records must be an array.`);
  }
  return snapshot.records;
}

function snapshotContentHash(snapshot, field) {
  return normalizeGuardHash(snapshot?.source?.contentHash, `${field} snapshot source.contentHash`);
}

function assertApplyGuard(options, { allSnapshot, t0Snapshot }) {
  if (!options.apply) return null;
  for (const key of APPLY_GUARD_KEYS) {
    if (options[key] === undefined || options[key] === null || options[key] === "") {
      const flag = key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
      throw new TypeError(`--${flag} is required for --apply.`);
    }
  }

  const expectedEtfCount = normalizeGuardCount(
    options.expectedEtfCount,
    "expectedEtfCount",
    { positive: true }
  );
  const expectedT0Count = normalizeGuardCount(options.expectedT0Count, "expectedT0Count");
  if (expectedT0Count > expectedEtfCount) {
    throw new TypeError("expectedT0Count cannot exceed expectedEtfCount.");
  }
  const expectedAllContentHash = normalizeGuardHash(
    options.expectedAllContentHash,
    "expectedAllContentHash"
  );
  const expectedT0ContentHash = normalizeGuardHash(
    options.expectedT0ContentHash,
    "expectedT0ContentHash"
  );

  const actualEtfCount = snapshotRecords(allSnapshot, "all ETF").length;
  const actualT0Count = snapshotRecords(t0Snapshot, "T+0 ETF").length;
  const actualAllContentHash = snapshotContentHash(allSnapshot, "all ETF");
  const actualT0ContentHash = snapshotContentHash(t0Snapshot, "T+0 ETF");

  const mismatches = [];
  if (actualEtfCount !== expectedEtfCount) {
    mismatches.push(`ETF count expected ${expectedEtfCount}, got ${actualEtfCount}`);
  }
  if (actualT0Count !== expectedT0Count) {
    mismatches.push(`T+0 count expected ${expectedT0Count}, got ${actualT0Count}`);
  }
  if (actualAllContentHash !== expectedAllContentHash) {
    mismatches.push(`all ETF content hash expected ${expectedAllContentHash}, got ${actualAllContentHash}`);
  }
  if (actualT0ContentHash !== expectedT0ContentHash) {
    mismatches.push(`T+0 ETF content hash expected ${expectedT0ContentHash}, got ${actualT0ContentHash}`);
  }
  if (mismatches.length > 0) {
    throw new TypeError(`apply guard mismatch: ${mismatches.join("; ")}.`);
  }

  return Object.freeze({
    expectedEtfCount,
    expectedT0Count,
    expectedAllContentHash,
    expectedT0ContentHash,
  });
}

function createSecurityMasterWriter(options) {
  return options.apply
    ? new LedgerSecurityMasterWriter({ dataRoot: options.dataRoot })
    : new DryRunSecurityMasterWriter();
}

async function validatePersistedSecurityMaster(dataRoot) {
  return new ValidateSecurityMasterUseCase({
    securityMasterSnapshotReader: new LedgerSecurityMasterReader({ dataRoot }),
    securityExecutionProfileResolver: createSecurityExecutionProfileResolver(),
  }).execute();
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

  const [allSnapshot, t0Snapshot] = await Promise.all([
    readJson(options.allSnapshot),
    readJson(options.t0Snapshot),
  ]);
  const applyGuard = assertApplyGuard(options, { allSnapshot, t0Snapshot });
  const source = new OfficialExchangeEtfSource({
    exchange: options.exchange,
    fetchAllEtfs: async () => allSnapshot,
    fetchT0Etfs: async () => t0Snapshot,
  });
  const useCase = new SyncEtfSecurityMasterUseCase({
    sources: [source],
    securityMasterWriter: createSecurityMasterWriter(options),
    securityExecutionProfileResolver: createSecurityExecutionProfileResolver(),
  });
  const syncResult = await useCase.execute();
  let postWriteValidation = null;
  if (options.apply && syncResult.ok) {
    postWriteValidation = await validatePersistedSecurityMaster(options.dataRoot);
  }
  const result = Object.freeze({
    ...syncResult,
    ok: syncResult.ok && (postWriteValidation?.ok ?? true),
    mode: options.apply ? "apply" : "dry_run",
    applyGuard,
    postWriteValidation,
  });
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
  APPLY_GUARD_KEYS,
  assertApplyGuard,
  createSecurityMasterWriter,
  main,
  normalizeGuardCount,
  normalizeGuardHash,
  parseArgs,
  readJson,
  snapshotContentHash,
  usage,
  validatePersistedSecurityMaster,
};
