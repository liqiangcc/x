"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createProxyCommand } = require("../src/adapters/cli/commands/proxy");

test("proxy router strips only the pool parent token", async () => {
  const calls = [];
  const command = createProxyCommand({
    clashCommand: async (argv) => calls.push(["clash", argv]),
    poolCommand: async (argv) => calls.push(["pool", argv]),
  });

  assert.equal(await command(["pool", "status", "--json"]), undefined);
  assert.deepEqual(calls, [["pool", ["status", "--json"]]]);
});

test("proxy router forwards every non-pool action unchanged to clash", async () => {
  const calls = [];
  const command = createProxyCommand({
    clashCommand: async (argv) => calls.push(argv),
    poolCommand: async () => assert.fail("pool must not run"),
  });

  await command(["list", "--group", "fast"]);
  await command(["unknown", "--value", "x"]);
  await command([]);

  assert.deepEqual(calls, [
    ["list", "--group", "fast"],
    ["unknown", "--value", "x"],
    [],
  ]);
});

test("proxy router requires both child command dependencies", () => {
  assert.throws(
    () => createProxyCommand({ clashCommand: async () => {} }),
    /poolCommand must be a function\./
  );
  assert.throws(
    () => createProxyCommand({ poolCommand: async () => {} }),
    /clashCommand must be a function\./
  );
});
