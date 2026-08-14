"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("ETF source, normalization, sync, and persistence adapters keep separate concerns", () => {
  const normalizer = source("src/market/etf_security_fact_normalizer.js");
  const sourceAdapter = source("src/sources/exchange/official_etf_source.js");
  const syncApplication = source("src/application/market/sync_etf_security_master.js");
  const ledgerWriter = source("src/adapters/ledger/ledger_security_master_writer.js");
  const dryRunWriter = source("src/adapters/market/dry_run_security_master_writer.js");

  for (const forbidden of [
    "node:fs",
    "node:http",
    "node:https",
    "requestText",
    "adapters/",
    "sources/",
    "simulation/execution",
    "mcp",
  ]) {
    assert.equal(normalizer.includes(forbidden), false, forbidden);
  }

  assert.equal(sourceAdapter.includes("ports/market/etf_security_source"), true);
  assert.equal(sourceAdapter.includes("security_master_writer"), false);
  assert.equal(sourceAdapter.includes("ledger_security_master"), false);
  assert.equal(sourceAdapter.includes("execution_profile_catalog"), false);
  assert.equal(sourceAdapter.includes("drawdown"), false);

  assert.equal(syncApplication.includes("ports/market/etf_security_source"), true);
  assert.equal(syncApplication.includes("ports/market/security_master_writer"), true);
  assert.equal(syncApplication.includes("validate_security_master"), true);
  assert.equal(syncApplication.includes("ledger_security_master_writer"), false);
  assert.equal(syncApplication.includes("official_etf_source"), false);
  assert.equal(syncApplication.includes("node:fs"), false);
  assert.equal(syncApplication.includes("node:path"), false);

  assert.equal(ledgerWriter.includes("node:fs"), true);
  assert.equal(ledgerWriter.includes("ports/market/security_master_writer"), true);
  assert.equal(ledgerWriter.includes("execution_profile"), false);
  assert.equal(ledgerWriter.includes("drawdown"), false);
  assert.equal(ledgerWriter.includes("mcp"), false);

  assert.equal(dryRunWriter.includes("ports/market/security_master_writer"), true);
  for (const forbidden of [
    "node:fs",
    "ledger_security_master_writer",
    "official_etf_source",
    "execution_profile",
    "drawdown",
    "mcp",
  ]) {
    assert.equal(dryRunWriter.includes(forbidden), false, forbidden);
  }
});
