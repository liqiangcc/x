"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  validateSecurityMasterEntries,
} = require("../src/market/security_master_quality_validator");
const {
  assertSecurityMasterSnapshotReader,
} = require("../src/ports/market/security_master_reader");
const {
  LedgerSecurityMasterReader,
} = require("../src/adapters/ledger/ledger_security_master_reader");
const {
  ValidateSecurityMasterUseCase,
} = require("../src/application/market/validate_security_master");

function source(version = "v1") {
  return {
    provider: "test_provider",
    document: "test/security-master.json",
    version,
    collectedAt: "2026-08-12T00:00:00.000Z",
  };
}

function record({
  code = "513500",
  market = 1,
  instrumentType = "etf",
  intradayRoundTripEligible = true,
  effectiveFrom = "2026-01-01",
  effectiveTo = null,
  version = "v1",
} = {}) {
  return {
    security: { code, market },
    instrumentType,
    intradayRoundTripEligible,
    effectiveFrom,
    effectiveTo,
    source: source(version),
    qualityIssues: [],
  };
}

function readSource(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("security master quality validator accepts adjacent temporal fact changes", () => {
  const result = validateSecurityMasterEntries([
    record({ effectiveTo: "2026-06-30", version: "h1" }),
    record({
      effectiveFrom: "2026-07-01",
      intradayRoundTripEligible: false,
      version: "h2",
    }),
  ]);

  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.summary, {
    recordCount: 2,
    validRecordCount: 2,
    invalidRecordCount: 0,
    securityCount: 1,
    errorCount: 0,
    warningCount: 0,
  });
});

test("security master quality validator rejects conflicting overlapping eligibility", () => {
  const result = validateSecurityMasterEntries([
    record({ effectiveTo: "2026-07-01", version: "left" }),
    record({
      effectiveFrom: "2026-07-01",
      intradayRoundTripEligible: false,
      version: "right",
    }),
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.summary.errorCount, 1);
  assert.equal(result.issues[0].code, "conflicting_security_fact_overlap");
  assert.equal(result.issues[0].securityKey, "1.513500");
  assert.deepEqual(result.issues[0].entryIndexes, [0, 1]);
});

test("same-priority duplicate facts fail while lower-priority shadowing is only a warning", () => {
  const duplicate = validateSecurityMasterEntries([
    { record: record({ version: "one" }), priority: 2 },
    { record: record({ version: "two" }), priority: 2 },
  ]);
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.issues[0].code, "duplicate_security_fact_window");
  assert.equal(duplicate.issues[0].severity, "error");

  const shadowed = validateSecurityMasterEntries([
    { record: record({ version: "explicit" }), priority: 2 },
    { record: record({ version: "set" }), priority: 1 },
  ]);
  assert.equal(shadowed.ok, true);
  assert.equal(shadowed.summary.warningCount, 1);
  assert.equal(shadowed.issues[0].code, "shadowed_security_fact_window");
  assert.equal(shadowed.issues[0].severity, "warning");
});

test("security master quality validator reports invalid provenance as a record error", () => {
  const invalid = record();
  invalid.source = { provider: "test_provider" };
  const result = validateSecurityMasterEntries([invalid]);

  assert.equal(result.ok, false);
  assert.equal(result.summary.invalidRecordCount, 1);
  assert.equal(result.issues[0].code, "invalid_security_master_record");
  assert.match(result.issues[0].message, /source.document/);
});

test("security master snapshot capability stays independent from point lookup capability", () => {
  const snapshotReader = { readSnapshot() { return { available: true, entries: [] }; } };
  assert.equal(assertSecurityMasterSnapshotReader(snapshotReader), snapshotReader);
  assert.throws(
    () => assertSecurityMasterSnapshotReader({ readRecord() { return null; } }),
    /readSnapshot/
  );
});

test("ledger security master snapshot preserves origin and precedence for audit", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "x-security-master-audit-"));
  try {
    fs.mkdirSync(path.join(root, "security_master"), { recursive: true });
    fs.mkdirSync(path.join(root, "universe", "20260701"), { recursive: true });
    fs.writeFileSync(path.join(root, "universe", "20260701", "stocks.json"), JSON.stringify({
      stocks: [{ code: "600001", market_id: 1 }],
    }));
    fs.writeFileSync(path.join(root, "security_master", "manifest.json"), JSON.stringify({
      schemaVersion: 1,
      recordSets: [{
        kind: "universe_snapshot",
        path: "universe/20260701/stocks.json",
        effectiveFrom: "2026-07-01",
        effectiveTo: null,
        classification: {
          instrumentType: "a_share",
          intradayRoundTripEligible: false,
        },
        source: source("set"),
        qualityIssues: [],
      }],
      records: [{
        ...record({
          code: "600001",
          instrumentType: "a_share",
          intradayRoundTripEligible: false,
          effectiveFrom: "2026-07-01",
          version: "explicit",
        }),
      }],
    }));

    const snapshot = new LedgerSecurityMasterReader({ dataRoot: root }).readSnapshot();
    assert.equal(snapshot.available, true);
    assert.equal(snapshot.entries.length, 2);
    assert.equal(snapshot.entries[0].priority, 2);
    assert.equal(snapshot.entries[0].origin.kind, "explicit_record");
    assert.equal(snapshot.entries[1].priority, 1);
    assert.equal(snapshot.entries[1].origin.kind, "record_set");
    assert.equal(snapshot.source.schemaVersion, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("quality audit use case validates profile resolvability without importing execution mechanics into Logic", async () => {
  const calls = [];
  const useCase = new ValidateSecurityMasterUseCase({
    securityMasterSnapshotReader: {
      readSnapshot() {
        return {
          available: true,
          entries: [{ record: record(), priority: 2 }],
          source: { kind: "test" },
        };
      },
    },
    securityExecutionProfileResolver: {
      resolve(input) {
        calls.push(input);
        return "t0_etf";
      },
    },
  });

  const result = await useCase.execute();
  assert.equal(result.ok, true);
  assert.equal(result.summary.profileResolutionCount, 1);
  assert.equal(result.summary.profileResolutionErrorCount, 0);
  assert.deepEqual(calls[0].security, { code: "513500", market: 1 });
  assert.equal(calls[0].metadata.intradayRoundTripEligible, true);
});

test("quality audit reports resolver failures and referenced-file integrity failures", async () => {
  const unresolvable = new ValidateSecurityMasterUseCase({
    securityMasterSnapshotReader: {
      readSnapshot() {
        return {
          available: true,
          entries: [{ record: record(), priority: 2 }],
          source: { kind: "test" },
        };
      },
    },
    securityExecutionProfileResolver: {
      resolve() {
        throw new Error("unsupported classification");
      },
    },
  });
  const unresolvableResult = await unresolvable.execute();
  assert.equal(unresolvableResult.ok, false);
  assert.equal(unresolvableResult.summary.profileResolutionErrorCount, 1);
  assert.equal(
    unresolvableResult.issues.some((issue) => issue.code === "security_execution_profile_unresolvable"),
    true
  );

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "x-security-master-broken-reference-"));
  try {
    fs.mkdirSync(path.join(root, "security_master"), { recursive: true });
    fs.writeFileSync(path.join(root, "security_master", "manifest.json"), JSON.stringify({
      schemaVersion: 1,
      recordSets: [{
        kind: "universe_snapshot",
        path: "universe/missing/stocks.json",
        effectiveFrom: "2026-07-01",
        effectiveTo: null,
        classification: {
          instrumentType: "a_share",
          intradayRoundTripEligible: false,
        },
        source: source("missing"),
        qualityIssues: [],
      }],
      records: [],
    }));
    const useCase = new ValidateSecurityMasterUseCase({
      securityMasterSnapshotReader: new LedgerSecurityMasterReader({ dataRoot: root }),
      securityExecutionProfileResolver: { resolve() { return "legacy_a_share"; } },
    });
    const result = await useCase.execute();
    assert.equal(result.ok, false);
    assert.equal(result.issues[0].code, "security_master_snapshot_load_failed");
    assert.match(result.issues[0].message, /ENOENT/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("security master quality Logic remains free of IO, protocol, and execution dependencies", () => {
  const validatorSource = readSource("src/market/security_master_quality_validator.js");
  for (const forbidden of [
    "node:fs",
    "node:path",
    "adapters/",
    "ports/",
    "simulation/",
    "mcp",
  ]) {
    assert.equal(validatorSource.includes(forbidden), false, forbidden);
  }

  const applicationSource = readSource("src/application/market/validate_security_master.js");
  for (const forbidden of ["node:fs", "node:path", "adapters/ledger", "adapters/mcp"]) {
    assert.equal(applicationSource.includes(forbidden), false, forbidden);
  }
});
