"use strict";

function requireCommand(command, label) {
  if (typeof command !== "function") {
    throw new TypeError(`${label} must be a function.`);
  }
  return command;
}

async function runProxyPoolCommand({
  argv = [],
  verifyCommand,
  selectCommand,
  statusCommand,
  refreshGithubCommand,
  lifecycleCommand,
  diagnoseCommand,
  probeCommand,
  benchmarkCommand,
  warmupCommand,
} = {}) {
  const action = argv[0];

  if (action === "verify") {
    await requireCommand(verifyCommand, "verifyCommand")(argv.slice(1));
    return;
  }
  if (action === "select") {
    await requireCommand(selectCommand, "selectCommand")(argv.slice(1));
    return;
  }
  if (action === "status") {
    await requireCommand(statusCommand, "statusCommand")(argv.slice(1));
    return;
  }
  if (action === "refresh-github") {
    await requireCommand(refreshGithubCommand, "refreshGithubCommand")(argv.slice(1));
    return;
  }
  if (["up", "down"].includes(action)) {
    await requireCommand(lifecycleCommand, "lifecycleCommand")(argv);
    return;
  }
  if (action === "diagnose") {
    await requireCommand(diagnoseCommand, "diagnoseCommand")(argv.slice(1));
    return;
  }
  if (action === "probe") {
    await requireCommand(probeCommand, "probeCommand")(argv.slice(1));
    return;
  }
  if (action === "benchmark") {
    await requireCommand(benchmarkCommand, "benchmarkCommand")(argv.slice(1));
    return;
  }
  if (action === "warmup") {
    await requireCommand(warmupCommand, "warmupCommand")(argv.slice(1));
    return;
  }

  throw new Error(`Unknown proxy pool command: ${action ?? ""}`);
}

function createProxyPoolCommand(commands = {}) {
  const resolved = {
    verifyCommand: requireCommand(commands.verifyCommand, "verifyCommand"),
    selectCommand: requireCommand(commands.selectCommand, "selectCommand"),
    statusCommand: requireCommand(commands.statusCommand, "statusCommand"),
    refreshGithubCommand: requireCommand(commands.refreshGithubCommand, "refreshGithubCommand"),
    lifecycleCommand: requireCommand(commands.lifecycleCommand, "lifecycleCommand"),
    diagnoseCommand: requireCommand(commands.diagnoseCommand, "diagnoseCommand"),
    probeCommand: requireCommand(commands.probeCommand, "probeCommand"),
    benchmarkCommand: requireCommand(commands.benchmarkCommand, "benchmarkCommand"),
    warmupCommand: requireCommand(commands.warmupCommand, "warmupCommand"),
  };

  return (argv = []) => runProxyPoolCommand({ argv, ...resolved });
}

module.exports = {
  createProxyPoolCommand,
  runProxyPoolCommand,
};
