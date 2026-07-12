"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  ComponentRegistry,
  DataMode,
  DEFAULT_SIMULATOR_CONFIG,
  OrderStatusValues,
  SessionStatusValues,
  assertPort,
  normalizeSecurityId,
  normalizeSimulatorConfig,
  securityKey,
} = require("../src/simulator");

test("simulator enums expose stable session and order states", () => {
  assert.deepEqual(SessionStatusValues, [
    "created",
    "waiting_for_decision",
    "running",
    "completed",
    "cancelled",
    "failed",
  ]);
  assert.deepEqual(OrderStatusValues, [
    "submitted",
    "accepted",
    "rejected",
    "filled",
    "cancelled",
    "expired",
  ]);
});

test("security IDs normalize to code and market keys", () => {
  assert.deepEqual(normalizeSecurityId({ code: " 600519 ", market: "1" }), {
    code: "600519",
    market: 1,
  });
  assert.equal(securityKey({ code: "000001", market: 0 }), "0.000001");
  assert.throws(() => normalizeSecurityId({ code: "ABC", market: 0 }), /six-digit/);
});

test("simulator config merges defaults and rejects unknown fields", () => {
  const config = normalizeSimulatorConfig({
    session: { startDate: "2026-03-02" },
    selection: { limit: 10 },
  });
  assert.equal(config.data.mode, DataMode.LEGACY_APPROXIMATE);
  assert.equal(config.session.initialCashYuan, 100000);
  assert.equal(config.session.startDate, "2026-03-02");
  assert.equal(config.selection.limit, 10);
  assert.equal(DEFAULT_SIMULATOR_CONFIG.selection.limit, 20);
  assert.throws(
    () => normalizeSimulatorConfig({ unknown: true }),
    (error) => error.code === "invalid_simulator_config" && error.issues.length > 0
  );
});

test("component registry creates registered components and rejects duplicates", () => {
  const registry = new ComponentRegistry();
  registry.register("ranker", "score", ({ params }) => ({ limit: params.limit }));
  assert.deepEqual(registry.create("ranker", { type: "score", limit: 20 }), { limit: 20 });
  assert.throws(() => registry.register("ranker", "score", () => null), /already registered/);
  assert.throws(
    () => registry.create("ranker", { type: "missing" }),
    (error) => error.code === "unknown_simulator_component"
  );
});

test("port contracts report missing methods", () => {
  const implementation = {
    getLegacyBar() {},
    getLegacyHistory() {},
    listAvailableCodes() {},
  };
  assert.equal(assertPort("marketDataRepository", implementation), implementation);
  assert.throws(
    () => assertPort("marketDataRepository", { listAvailableCodes() {} }),
    /getLegacyBar, getLegacyHistory/
  );
});

test("core modules do not import adapters or infrastructure", () => {
  const coreDir = path.join(__dirname, "..", "src", "simulator", "core");
  const forbidden = /require\(["'](?:node:fs|node:path|fastify|better-sqlite3|\.\.\/adapters)/;
  for (const filename of fs.readdirSync(coreDir)) {
    if (!filename.endsWith(".js")) continue;
    const source = fs.readFileSync(path.join(coreDir, filename), "utf8");
    assert.doesNotMatch(source, forbidden, filename);
  }
});
