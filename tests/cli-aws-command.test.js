"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createAwsCommand } = require("../src/adapters/cli/commands/aws");

function createCommands(calls) {
  return {
    probeRouterCommand: async (argv) => {
      calls.push(["probe-router", argv]);
      return "probe";
    },
    maintenanceCommand: async (argv) => {
      calls.push(["maintenance", argv]);
      return "maintenance";
    },
    latencyCommand: async (argv) => {
      calls.push(["latency", argv]);
      return "latency";
    },
  };
}

test("AWS router delegates probe-router and latency without their subcommand token", async () => {
  const calls = [];
  const command = createAwsCommand(createCommands(calls));

  assert.equal(
    await command(["probe-router", "--secid", "1.600519"]),
    "probe"
  );
  assert.equal(await command(["latency", "--attempts", "2"]), "latency");
  assert.deepEqual(calls, [
    ["probe-router", ["--secid", "1.600519"]],
    ["latency", ["--attempts", "2"]],
  ]);
});

test("AWS router preserves the subcommand token for maintenance adapter", async () => {
  const calls = [];
  const command = createAwsCommand(createCommands(calls));

  assert.equal(await command(["status", "--profile", "dev"]), "maintenance");
  assert.equal(
    await command(["sync-github-secrets", "--repo", "owner/repo"]),
    "maintenance"
  );
  assert.deepEqual(calls, [
    ["maintenance", ["status", "--profile", "dev"]],
    ["maintenance", ["sync-github-secrets", "--repo", "owner/repo"]],
  ]);
});

test("AWS router validates malformed unknown-command options before unknown error", async () => {
  const command = createAwsCommand(createCommands([]));

  await assert.rejects(
    () => command(["unknown", "--value"]),
    /Missing value for --value/
  );
  await assert.rejects(
    () => command(["unknown", "--json"]),
    /Unknown aws command: unknown/
  );
});

test("AWS router preserves the empty unknown-command diagnostic", async () => {
  const command = createAwsCommand(createCommands([]));
  await assert.rejects(() => command([]), /Unknown aws command: $/);
});
