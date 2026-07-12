"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { executePolicy, normalizePolicy } = require("../src/kline/policy");
const { parseArguments } = require("../fetch/fetch_kline");

test("policy executor falls back in configured order and records failures", async () => {
  const calls = [];
  const result = await executePolicy(normalizePolicy("test", { test: { engines: ["proxy-pool", "local"] } }), {
    "proxy-pool": async () => { calls.push("proxy-pool"); throw new Error("unavailable"); },
    local: async () => { calls.push("local"); return { source_engine: "local", data: { klines: ["row"] } }; },
  });
  assert.deepEqual(calls, ["proxy-pool", "local"]);
  assert.equal(result.source_policy, "test");
  assert.equal(result.policy_failures[0].engine, "proxy-pool");
});

test("policy executor honors per-engine attempts", async () => {
  let attempts = 0;
  await assert.rejects(() => executePolicy({ name: "retry", engines: [{ name: "proxy-pool", attempts: 2 }] }, {
    "proxy-pool": async () => { attempts += 1; throw new Error("failed"); },
  }), /Kline policy retry failed/);
  assert.equal(attempts, 2);
});

test("fetch CLI rejects simultaneous policy and engine", () => {
  assert.throws(() => parseArguments(["600519", "--policy", "auto", "--engine", "local"]), /cannot be used together/);
});

test("explicit proxy attempts are preserved for policy override", () => {
  const options = parseArguments(["600519", "--policy", "proxy-only", "--proxy-max-attempts", "1"]);
  assert.equal(options.proxyMaxAttempts, 1);
  assert.equal(options.proxyMaxAttemptsExplicit, true);
});
