"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  normalizeSecurityMasterRecord,
} = require("../src/market/security_master_record");
const {
  assertSecurityMasterReader,
} = require("../src/ports/market/security_master_reader");
const {
  LedgerSecurityMasterReader,
} = require("../src/adapters/ledger/ledger_security_master_reader");
const {
  LedgerSecurityMetadataReader,
} = require("../src/adapters/ledger/ledger_security_metadata_reader");

function auditSource(version = "v1") {
  return {
    provider: "test_provider",
    document: "test/document.json",
    version,
    collectedAt: "2026-08-12T00:00:00.000Z",
  };
}

function createSecurityMasterFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "x-security-master-"));
  fs.mkdirSync(path.join(root, "security_master"), { recursive: true });
  fs.mkdirSync(path.join(root, "universe", "20260701"), { recursive: true });
  fs.writeFileSync(path.join(root, "universe", "20260701", "stocks.json"), JSON.stringify({
    stocks: [
      { code: "600001", market_id: 1, name: "Example" },
      { code: "000001", market_id: 0, name: "Example SZ" },
    ],
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
      source: auditSource("universe-20260701"),
      qualityIssues: ["set_level_classification"],
    }],
    records: [
      {
        security: { code: "600001", market: 1 },
        instrumentType: "a_share",
        intradayRoundTripEligible: false,
        effectiveFrom: "2026-07-01",
        effectiveTo: null,
        source: auditSource("explicit-a-share"),
        qualityIssues: ["verified", "verified"],
      },
      {
        security: { code: "513500", market: 1 },
        instrumentType: "etf",
        intradayRoundTripEligible: true,
        effectiveFrom: "2026-01-01",
        effectiveTo: "2026-06-30",
        source: auditSource("etf-h1"),
        qualityIssues: [],
      },
      {
        security: { code: "513500", market: 1 },
        instrumentType: "etf",
        intradayRoundTripEligible: false,
        effectiveFrom: "2026-07-01",
        effectiveTo: null,
        source: auditSource("etf-h2"),
        qualityIssues: ["test_changed_eligibility"],
      },
    ],
  }, null, 2));
  return root;
}

test("SecurityMasterRecord normalizes auditable security facts", () => {
  assert.deepEqual(normalizeSecurityMasterRecord({
    security: { code: "513500", market: 1 },
    instrumentType: "etf",
    intradayRoundTripEligible: true,
    effectiveFrom: "20260101",
    effectiveTo: "2026-12-31",
    source: auditSource(),
    qualityIssues: ["b", "a", "b"],
  }), {
    security: { code: "513500", market: 1 },
    instrumentType: "etf",
    intradayRoundTripEligible: true,
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-12-31",
    source: auditSource(),
    qualityIssues: ["a", "b"],
  });
});

test("SecurityMasterRecord rejects contradictory, unbounded, or unauditable facts", () => {
  assert.throws(() => normalizeSecurityMasterRecord({
    security: { code: "600001", market: 1 },
    instrumentType: "a_share",
    intradayRoundTripEligible: true,
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    source: auditSource(),
    qualityIssues: [],
  }), /cannot declare intradayRoundTripEligible=true/);

  assert.throws(() => normalizeSecurityMasterRecord({
    security: { code: "510300", market: 1 },
    instrumentType: "etf",
    intradayRoundTripEligible: false,
    effectiveFrom: "2026-08-01",
    effectiveTo: "2026-07-31",
    source: auditSource(),
    qualityIssues: [],
  }), /effectiveTo/);

  assert.throws(() => normalizeSecurityMasterRecord({
    security: { code: "510300", market: 1 },
    instrumentType: "etf",
    intradayRoundTripEligible: false,
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    source: { provider: "x" },
    qualityIssues: [],
  }), /source.document/);
});

test("SecurityMasterReader port stays narrow", () => {
  const reader = { readRecord() { return null; } };
  assert.equal(assertSecurityMasterReader(reader), reader);
  assert.throws(() => assertSecurityMasterReader(null), /must be an object/);
  assert.throws(() => assertSecurityMasterReader({}), /readRecord/);
});

test("ledger security master normalizes record sets and gives explicit records precedence", () => {
  const dataRoot = createSecurityMasterFixture();
  try {
    const reader = new LedgerSecurityMasterReader({ dataRoot });
    const record = reader.readRecord({ code: "600001", market: 1 });
    assert.equal(record.instrumentType, "a_share");
    assert.equal(record.intradayRoundTripEligible, false);
    assert.equal(record.source.version, "explicit-a-share");
    assert.deepEqual(record.qualityIssues, ["verified"]);

    const inherited = reader.readRecord({ code: "000001", market: 0 });
    assert.equal(inherited.source.version, "universe-20260701");
    assert.deepEqual(inherited.qualityIssues, ["set_level_classification"]);
    assert.equal(reader.readRecord({ code: "510300", market: 1 }), null);
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("ledger security master supports as-of selection while defaulting to latest fact", () => {
  const dataRoot = createSecurityMasterFixture();
  try {
    const reader = new LedgerSecurityMasterReader({ dataRoot });
    assert.equal(
      reader.readRecord({ code: "513500", market: 1 }, { asOf: "2026-06-30" }).intradayRoundTripEligible,
      true
    );
    assert.equal(
      reader.readRecord({ code: "513500", market: 1 }, { asOf: "2026-07-01" }).intradayRoundTripEligible,
      false
    );
    assert.equal(
      reader.readRecord({ code: "513500", market: 1 }).source.version,
      "etf-h2"
    );
    assert.equal(
      reader.readRecord({ code: "513500", market: 1 }, { asOf: "2025-12-31" }),
      null
    );
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("ledger security metadata reader only projects the SecurityMasterRecord", () => {
  const reader = new LedgerSecurityMetadataReader({
    securityMasterReader: {
      readRecord(security, options) {
        assert.deepEqual(security, { code: "513500", market: 1 });
        assert.deepEqual(options, { asOf: "2026-06-30" });
        return normalizeSecurityMasterRecord({
          security,
          instrumentType: "etf",
          intradayRoundTripEligible: true,
          effectiveFrom: "2026-01-01",
          effectiveTo: "2026-06-30",
          source: auditSource("projection"),
          qualityIssues: ["audited"],
        });
      },
    },
  });

  assert.deepEqual(reader.readMetadata(
    { code: "513500", market: 1 },
    { asOf: "2026-06-30" }
  ), {
    instrumentType: "etf",
    intradayRoundTripEligible: true,
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-06-30",
    source: {
      kind: "security_master",
      ...auditSource("projection"),
    },
    qualityIssues: ["audited"],
  });
});

test("ledger security master fails closed on missing data and blocks paths outside dataRoot", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "x-security-master-missing-"));
  try {
    const missing = new LedgerSecurityMasterReader({ dataRoot: root });
    assert.equal(missing.readRecord({ code: "600001", market: 1 }), null);

    fs.mkdirSync(path.join(root, "security_master"), { recursive: true });
    fs.writeFileSync(path.join(root, "security_master", "manifest.json"), JSON.stringify({
      schemaVersion: 1,
      recordSets: [{
        kind: "universe_snapshot",
        path: "../outside.json",
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        classification: { instrumentType: "a_share", intradayRoundTripEligible: false },
        source: auditSource(),
        qualityIssues: [],
      }],
      records: [],
    }));
    const unsafe = new LedgerSecurityMasterReader({ dataRoot: root });
    assert.throws(
      () => unsafe.readRecord({ code: "600001", market: 1 }),
      /must stay within dataRoot/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
