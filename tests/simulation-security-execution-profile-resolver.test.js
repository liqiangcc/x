"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  assertSecurityMetadataReader,
} = require("../src/ports/market/security_metadata_reader");
const {
  assertSecurityExecutionProfileResolver,
} = require("../src/ports/simulation/security_execution_profile_resolver");
const {
  LedgerSecurityMetadataReader,
} = require("../src/adapters/ledger/ledger_security_metadata_reader");
const {
  createSecurityExecutionProfileResolver,
} = require("../src/simulation/execution/security_execution_profile_resolver");

function createUniverseFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "x-security-metadata-"));
  fs.writeFileSync(path.join(root, "summary.json"), JSON.stringify({
    date: "20260701",
    market: "hs-a",
  }));
  fs.mkdirSync(path.join(root, "20260701"));
  fs.writeFileSync(path.join(root, "20260701", "stocks.json"), JSON.stringify({
    stocks: [
      { code: "600001", market_id: 1, name: "Example" },
      { code: "000001", market_id: 0, name: "Example SZ" },
    ],
  }));
  return root;
}

test("security metadata reader port accepts only the narrow readMetadata capability", () => {
  const reader = { readMetadata() { return null; } };
  assert.equal(assertSecurityMetadataReader(reader), reader);
  assert.throws(() => assertSecurityMetadataReader(null), /must be an object/);
  assert.throws(() => assertSecurityMetadataReader({}), /readMetadata/);
});

test("ledger security metadata reader classifies only securities present in the hs-a universe snapshot", () => {
  const universeRoot = createUniverseFixture();
  try {
    const reader = new LedgerSecurityMetadataReader({ universeRoot });
    assert.deepEqual(reader.readMetadata({ code: "600001", market: 1 }), {
      instrumentType: "a_share",
      intradayRoundTripEligible: false,
      source: { kind: "repo_universe", market: "hs-a", date: "20260701" },
    });
    assert.equal(reader.readMetadata({ code: "510300", market: 1 }), null);
  } finally {
    fs.rmSync(universeRoot, { recursive: true, force: true });
  }
});

test("security execution profile resolver maps explicit instrument metadata without execution mechanics", () => {
  const resolver = createSecurityExecutionProfileResolver();
  assert.equal(assertSecurityExecutionProfileResolver(resolver), resolver);
  assert.equal(resolver.resolve({
    security: { code: "600001", market: 1 },
    metadata: { instrumentType: "a_share" },
  }), "legacy_a_share");
  assert.equal(resolver.resolve({
    security: { code: "510300", market: 1 },
    metadata: { instrumentType: "etf", intradayRoundTripEligible: false },
  }), "domestic_stock_etf");
  assert.equal(resolver.resolve({
    security: { code: "513500", market: 1 },
    metadata: { instrumentType: "etf", intradayRoundTripEligible: true },
  }), "t0_etf");
});

test("security execution profile resolver fails closed for incomplete or contradictory eligibility metadata", () => {
  const resolver = createSecurityExecutionProfileResolver();
  assert.throws(
    () => resolver.resolve({
      security: { code: "510300", market: 1 },
      metadata: { instrumentType: "etf" },
    }),
    /must explicitly declare intradayRoundTripEligible/
  );
  assert.throws(
    () => resolver.resolve({
      security: { code: "600001", market: 1 },
      metadata: { instrumentType: "a_share", intradayRoundTripEligible: true },
    }),
    /cannot declare intradayRoundTripEligible=true/
  );
  assert.throws(
    () => resolver.resolve({
      security: { code: "600001", market: 1 },
      metadata: { instrumentType: "fund" },
    }),
    /instrumentType/
  );
});
