"use strict";

const { parseCliOptions } = require("../option_parser");

function parseProxyClashOptions(argv, defaults = {}) {
  return parseCliOptions(argv, defaults);
}

function requireCapability(capability, action) {
  const methods = {
    list: "listProxies",
    rotate: "rotateProxy",
    check: "checkEastmoneyAccess",
  };
  const method = methods[action];
  if (!capability || typeof capability[method] !== "function") {
    throw new TypeError(`proxy clash capability must expose ${method}().`);
  }
  return capability;
}

async function runProxyClashCommand({
  argv = [],
  capability,
  getCapability,
  stdout = process.stdout,
} = {}) {
  const action = argv[0];
  const options = parseProxyClashOptions(argv.slice(1));

  if (!["list", "rotate", "check"].includes(action)) {
    throw new Error(`Unknown proxy command: ${action ?? ""}`);
  }

  const resolvedCapability = requireCapability(
    capability ?? getCapability?.(),
    action,
  );

  let result;
  if (action === "list") {
    result = await resolvedCapability.listProxies({
      configFile: options.config,
      groupName: options.group,
    });
  } else if (action === "rotate") {
    result = await resolvedCapability.rotateProxy({
      configFile: options.config,
      groupName: options.group,
      proxyName: options.proxy ?? null,
    });
  } else {
    result = await resolvedCapability.checkEastmoneyAccess();
  }

  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

function createProxyClashCommand({
  stdout = process.stdout,
  capability,
  createCapability,
} = {}) {
  let resolvedCapability = capability;

  function getCapability() {
    if (resolvedCapability) {
      return resolvedCapability;
    }
    resolvedCapability = createCapability
      ? createCapability()
      : require("../../../proxy/clash");
    return resolvedCapability;
  }

  return (argv = []) => runProxyClashCommand({
    argv,
    getCapability,
    stdout,
  });
}

module.exports = {
  createProxyClashCommand,
  parseProxyClashOptions,
  runProxyClashCommand,
};
