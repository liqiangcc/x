"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createProxyPoolCommand } = require("../src/adapters/cli/commands/proxy_pool");

function createCommands(calls) {
  const record = (name) => async (argv) => {
    calls.push([name, argv]);
    return `${name}-result`;
  };

  return {
    verifyCommand: record("verify"),
    selectCommand: record("select"),
    statusCommand: record("status"),
    refreshGithubCommand: record("refresh-github"),
    lifecycleCommand: record("lifecycle"),
    diagnoseCommand: record("diagnose"),
    probeCommand: record("probe"),
    benchmarkCommand: record("benchmark"),
    warmupCommand: record("warmup"),
  };
}

test("proxy pool router strips the action token for non-lifecycle child commands", async () => {
  const calls = [];
  const command = createProxyPoolCommand(createCommands(calls));

  for (const action of [
    "verify",
    "select",
    "status",
    "refresh-github",
    "diagnose",
    "probe",
    "benchmark",
    "warmup",
  ]) {
    assert.equal(await command([action, "--value", "x"]), undefined);
  }

  assert.deepEqual(calls, [
    ["verify", ["--value", "x"]],
    ["select", ["--value", "x"]],
    ["status", ["--value", "x"]],
    ["refresh-github", ["--value", "x"]],
    ["diagnose", ["--value", "x"]],
    ["probe", ["--value", "x"]],
    ["benchmark", ["--value", "x"]],
    ["warmup", ["--value", "x"]],
  ]);
});

test("proxy pool router preserves the lifecycle action token for up and down", async () => {
  const calls = [];
  const command = createProxyPoolCommand(createCommands(calls));

  await command(["up", "--unexpected"]);
  await command(["down", "--unexpected"]);

  assert.deepEqual(calls, [
    ["lifecycle", ["up", "--unexpected"]],
    ["lifecycle", ["down", "--unexpected"]],
  ]);
});

test("proxy pool router preserves the exact unknown-command error and does not delegate", async () => {
  const calls = [];
  const command = createProxyPoolCommand(createCommands(calls));

  await assert.rejects(() => command(["unknown"]), /Unknown proxy pool command: unknown/);
  await assert.rejects(() => command([]), /Unknown proxy pool command: $/);
  assert.deepEqual(calls, []);
});

test("proxy pool router requires every child command dependency", () => {
  const commands = createCommands([]);
  delete commands.probeCommand;

  assert.throws(
    () => createProxyPoolCommand(commands),
    /probeCommand must be a function\./
  );
});
