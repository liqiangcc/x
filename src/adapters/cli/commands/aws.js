"use strict";

const { parseCliOptions } = require("../option_parser");

function requireCommand(command, label) {
  if (typeof command !== "function") {
    throw new TypeError(`${label} must be a function.`);
  }
  return command;
}

async function runAwsCommand({
  argv = [],
  probeRouterCommand,
  maintenanceCommand,
  latencyCommand,
} = {}) {
  const subcommand = argv[0];

  if (subcommand === "probe-router") {
    return requireCommand(probeRouterCommand, "probeRouterCommand")(argv.slice(1));
  }

  if (["status", "sync-github-secrets"].includes(subcommand)) {
    return requireCommand(maintenanceCommand, "maintenanceCommand")(argv);
  }

  if (subcommand === "latency") {
    return requireCommand(latencyCommand, "latencyCommand")(argv.slice(1));
  }

  // Preserve the legacy parent-router contract: malformed options fail before
  // the unknown-subcommand error is emitted.
  parseCliOptions(argv.slice(1));
  throw new Error(`Unknown aws command: ${subcommand ?? ""}`);
}

function createAwsCommand({
  probeRouterCommand,
  maintenanceCommand,
  latencyCommand,
} = {}) {
  const resolvedProbeRouterCommand = requireCommand(
    probeRouterCommand,
    "probeRouterCommand"
  );
  const resolvedMaintenanceCommand = requireCommand(
    maintenanceCommand,
    "maintenanceCommand"
  );
  const resolvedLatencyCommand = requireCommand(
    latencyCommand,
    "latencyCommand"
  );

  return (argv = []) => runAwsCommand({
    argv,
    probeRouterCommand: resolvedProbeRouterCommand,
    maintenanceCommand: resolvedMaintenanceCommand,
    latencyCommand: resolvedLatencyCommand,
  });
}

module.exports = {
  createAwsCommand,
  runAwsCommand,
};
