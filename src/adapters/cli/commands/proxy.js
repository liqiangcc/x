"use strict";

function requireCommand(command, label) {
  if (typeof command !== "function") {
    throw new TypeError(`${label} must be a function.`);
  }
  return command;
}

async function runProxyCommand({
  argv = [],
  clashCommand,
  poolCommand,
} = {}) {
  const action = argv[0];

  if (action === "pool") {
    await requireCommand(poolCommand, "poolCommand")(argv.slice(1));
    return;
  }

  await requireCommand(clashCommand, "clashCommand")(argv);
}

function createProxyCommand({
  clashCommand,
  poolCommand,
} = {}) {
  const resolvedClashCommand = requireCommand(clashCommand, "clashCommand");
  const resolvedPoolCommand = requireCommand(poolCommand, "poolCommand");

  return (argv = []) => runProxyCommand({
    argv,
    clashCommand: resolvedClashCommand,
    poolCommand: resolvedPoolCommand,
  });
}

module.exports = {
  createProxyCommand,
  runProxyCommand,
};
