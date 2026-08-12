"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { assertKlineReader } = require("../src/ports/market/kline_reader");
const { LedgerKlineReader } = require("../src/adapters/ledger/ledger_kline_reader");

function fakeHistory(overrides = {}) {
  return {
    security: { code: "600001", market: 1 },
    period: "daily",
    bars: [
      { date: "2026-07-01", close: 10.1 },
      { date: "2026-07-02", close: 10.2 },
      { date: "2026-07-03", close: 10.3 },
    ],
    dataMode: "legacy_approximate",
    priceView: "legacy_forward_adjusted",
    contentHash: "abc123",
    sourcePath: "data/kline/daily/600/600001.json",
    qualityIssues: ["legacy_approximate", "legacy_approximate"],
    ...overrides,
  };
}

test("kline reader port accepts only implementations with readRange", () => {
  const implementation = { readRange: async () => ({}) };
  assert.equal(assertKlineReader(implementation), implementation);
  assert.throws(() => assertKlineReader({}), /readRange/);
  assert.throws(() => assertKlineReader(null), /object/);
});

test("ledger kline reader delegates storage access and applies range before limit", async () => {
  const calls = [];
  const repository = {
    async getLegacyHistory(input) {
      calls.push(input);
      return fakeHistory();
    },
  };
  const reader = new LedgerKlineReader({ repository });
  assert.equal(assertKlineReader(reader), reader);

  const result = await reader.readRange({
    code: "600001",
    market: 1,
    startDate: "2026-07-02",
    endDate: "20260703",
    period: "daily",
    limit: 1,
  });

  assert.deepEqual(calls, [{
    code: "600001",
    market: 1,
    endDate: "2026-07-03",
    period: "daily",
    limit: null,
  }]);
  assert.deepEqual(result.bars, [{ date: "2026-07-03", close: 10.3 }]);
  assert.equal(result.startDate, "2026-07-02");
  assert.equal(result.endDate, "2026-07-03");
});

test("ledger kline reader maps legacy repository metadata into shared result", async () => {
  const reader = new LedgerKlineReader({
    repository: { getLegacyHistory: async () => fakeHistory() },
  });
  const result = await reader.readRange({
    code: "600001",
    market: 1,
    endDate: "2026-07-03",
  });

  assert.deepEqual(result.security, { code: "600001", market: 1 });
  assert.equal(result.dataMode, "legacy_approximate");
  assert.equal(result.priceView, "legacy_forward_adjusted");
  assert.deepEqual(result.qualityIssues, ["legacy_approximate"]);
  assert.deepEqual(result.source, {
    kind: "repo_ledger",
    contentHash: "abc123",
    path: "data/kline/daily/600/600001.json",
  });
});

test("ledger kline reader validates control inputs before storage access", async () => {
  let callCount = 0;
  const reader = new LedgerKlineReader({
    repository: {
      async getLegacyHistory() {
        callCount += 1;
        return fakeHistory();
      },
    },
  });

  await assert.rejects(
    () => reader.readRange({ code: "600001", market: 1, startDate: "2026-07-04", endDate: "2026-07-03" }),
    /startDate/
  );
  await assert.rejects(
    () => reader.readRange({ code: "600001", market: 1, endDate: "2026-07-03", limit: 0 }),
    /limit/
  );
  assert.equal(callCount, 0);
});
