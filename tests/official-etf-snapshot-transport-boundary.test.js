"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("official ETF snapshot transport owns IO only and stays outside Security Master and execution concerns", () => {
  const transport = source("src/sources/exchange/official_export_file_transport.js");
  const resolver = source("src/sources/exchange/official_snapshot_transport_resolver.js");
  const verifiedXls = source("src/sources/exchange/verified_xls_snapshot_transport.js");
  const probe = source("src/sources/exchange/official_export_probe.js");
  const probeCli = source("scripts/probe_official_etf_export.js");
  const captureCli = source("scripts/capture_official_etf_snapshot.js");
  const transportPort = source("src/ports/market/etf_snapshot_transport.js");
  const officialSource = source("src/sources/exchange/official_etf_source.js");

  assert.equal(transport.includes("node:fs/promises"), true);
  assert.equal(transport.includes("node:crypto"), true);
  assert.equal(transport.includes("official_exchange_provenance"), true);
  assert.equal(transport.includes("etf_snapshot_transport"), true);

  for (const forbidden of [
    "security_master_writer",
    "ledger_security_master",
    "validate_security_master",
    "security_execution_profile",
    "buy_execution_model",
    "drawdown",
    "adapters/mcp",
  ]) {
    assert.equal(transport.includes(forbidden), false, forbidden);
    assert.equal(resolver.includes(forbidden), false, `resolver: ${forbidden}`);
    assert.equal(verifiedXls.includes(forbidden), false, `verified XLS: ${forbidden}`);
    assert.equal(probe.includes(forbidden), false, `probe: ${forbidden}`);
    assert.equal(probeCli.includes(forbidden), false, `probe CLI: ${forbidden}`);
    assert.equal(captureCli.includes(forbidden), false, `capture CLI: ${forbidden}`);
  }

  // Generic transport remains generic. Concrete format selection belongs only
  // to the resolver/composition boundary.
  assert.equal(transport.includes("verified_xls_snapshot_transport"), false);
  assert.equal(transport.includes("exchange === \"sse\""), false);
  assert.equal(resolver.includes("official_export_file_transport"), true);
  assert.equal(resolver.includes("verified_xls_snapshot_transport"), true);
  assert.equal(captureCli.includes("official_snapshot_transport_resolver"), true);
  assert.equal(captureCli.includes("verified_xls_snapshot_transport"), false);

  // Probe logic is deterministic over bytes. Only its CLI owns file IO.
  for (const forbidden of ["node:fs", "node:http", "node:https", "application/", "adapters/"]) {
    assert.equal(probe.includes(forbidden), false, `probe: ${forbidden}`);
  }
  assert.equal(probeCli.includes("node:fs/promises"), true);

  for (const forbidden of ["node:fs", "node:http", "node:https", "application/", "adapters/"]) {
    assert.equal(transportPort.includes(forbidden), false, forbidden);
  }

  // The source consumes the standardized snapshot contract through injected
  // functions. It must not know whether the snapshot came from CSV, HTML,
  // JSON, XLS, a future HTTP API, or any particular local path.
  for (const forbidden of [
    "official_export_file_transport",
    "official_export_probe",
    "verified_xls_snapshot_transport",
    "official_snapshot_transport_resolver",
    "node:fs",
    ".csv",
    ".xlsx",
    ".xls",
    "filePath",
  ]) {
    assert.equal(officialSource.includes(forbidden), false, forbidden);
  }

  // Transport extracts only explicit exchange fields. T+0 eligibility remains
  // set-membership logic in OfficialExchangeEtfSource, never a name/prefix guess.
  // Generic startsWith() calls are valid for unrelated normalization such as
  // SHA-256 prefixes, so guard only against startsWith() on security-code values.
  assert.equal(/\b(?:code|securityCode)\s*\.\s*startsWith\s*\(/.test(transport), false);
  assert.equal(/\b(?:code|securityCode)\s*\.\s*startsWith\s*\(/.test(resolver), false);
  assert.equal(/\b(?:code|securityCode)\s*\.\s*startsWith\s*\(/.test(verifiedXls), false);
  assert.equal(transport.includes("includes(\"ETF\")"), false);
  assert.equal(resolver.includes("includes(\"ETF\")"), false);
  assert.equal(verifiedXls.includes("intradayRoundTripEligible"), false);
});
