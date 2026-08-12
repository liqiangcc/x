"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("ETF source, normalization, sync, and ledger persistence keep separate concerns", () => {
  const normalizer = source("src/market/etf_security_fact_normalizer.js");
  const sourceAdapter = source("src/sources/exchange/official_etf_source.js");
  const syncApplication = source("src/application/market/sync_etf_security_master.js");
  const writer = source("src/adapters/ledger/ledger_security_master_writer.js");

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

  assert.equal(writer.includes("node:fs"), true);
  assert.equal(writer.includes("ports/market/security_master_writer"), true);
  assert.equal(writer.includes("execution_profile"), false);
  assert.equal(writer.includes("drawdown"), false);
  assert.equal(writer.includes("mcp"), false);
});
