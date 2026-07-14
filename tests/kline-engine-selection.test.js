"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { selectStrategySyncEngine } = require("../src/kline/engine_selection");

test("strategy sync uses local after a successful batch probe", async () => {
  const result = await selectStrategySyncEngine({
    codes: ["600519"],
    getKlineImpl: async () => ({ data: { klines: ["row"] } }),
    requestedEngine: "auto",
    selectedCodeCount: 259,
    threshold: 500,
  });
  assert.equal(result.engine, "local");
  assert.equal(result.reason, "local_probe_succeeded");
  assert.equal(result.localProbe.ok, true);
});

test("strategy sync uses only the CN proxy pool when the local probe is blocked", async () => {
  const result = await selectStrategySyncEngine({
    codes: ["600519"],
    getKlineImpl: async () => { throw new Error("socket hang up"); },
    requestedEngine: "auto",
    selectedCodeCount: 259,
    threshold: 500,
  });
  assert.equal(result.engine, "proxy-pool");
  assert.equal(result.policy, "cn-proxy-only");
  assert.equal(result.localProbe.ok, false);
});

test("strategy sync keeps auto at or above the configured threshold", async () => {
  assert.equal((await selectStrategySyncEngine({ requestedEngine: "auto", selectedCodeCount: 500 })).engine, "auto");
  assert.equal((await selectStrategySyncEngine({ requestedEngine: "auto", selectedCodeCount: 501 })).engine, "auto");
});

test("strategy sync respects an explicitly selected engine", async () => {
  assert.equal((await selectStrategySyncEngine({ requestedEngine: "aws", selectedCodeCount: 10 })).engine, "aws");
  assert.equal((await selectStrategySyncEngine({ requestedEngine: "proxy-pool", selectedCodeCount: 10 })).engine, "proxy-pool");
});
