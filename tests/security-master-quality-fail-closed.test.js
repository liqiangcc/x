"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ValidateSecurityMasterUseCase,
} = require("../src/application/market/validate_security_master");

function createUseCase(snapshot) {
  return new ValidateSecurityMasterUseCase({
    securityMasterSnapshotReader: {
      readSnapshot() {
        return snapshot;
      },
    },
    securityExecutionProfileResolver: {
      resolve() {
        return "legacy_a_share";
      },
    },
  });
}

test("security master audit fails closed when the manifest is unavailable", async () => {
  const result = await createUseCase({
    available: false,
    entries: [],
    source: { kind: "test" },
  }).execute();

  assert.equal(result.ok, false);
  assert.equal(result.issues[0].code, "security_master_unavailable");
});

test("security master audit rejects malformed snapshot entries", async () => {
  const result = await createUseCase({
    available: true,
    source: { kind: "test" },
  }).execute();

  assert.equal(result.ok, false);
  assert.equal(result.issues[0].code, "security_master_snapshot_load_failed");
  assert.match(result.issues[0].message, /entries must be an array/);
});

test("security master audit rejects an empty but otherwise available master", async () => {
  const result = await createUseCase({
    available: true,
    entries: [],
    source: { kind: "test" },
  }).execute();

  assert.equal(result.ok, false);
  assert.equal(result.issues[0].code, "security_master_empty");
  assert.equal(result.summary.errorCount, 1);
});
