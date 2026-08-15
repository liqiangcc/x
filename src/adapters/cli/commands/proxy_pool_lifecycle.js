"use strict";

const { parseCliOptions } = require("../option_parser");

function parseProxyPoolLifecycleOptions(argv, defaults = {}) {
  return parseCliOptions(argv, defaults);
}

function requireCompose(compose) {
  if (!compose || typeof compose.run !== "function") {
    throw new TypeError("proxy pool lifecycle compose capability must expose run().");
  }
  return compose;
}

function composeArgsForAction(action) {
  if (action === "up") {
    return ["up", "-d", "--build"];
  }
  if (action === "down") {
    return ["down"];
  }
  throw new Error(`Unknown proxy pool lifecycle action: ${action ?? ""}`);
}

async function runProxyPoolLifecycleCommand({
  argv = [],
  compose,
  getCompose,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const action = argv[0];
  parseProxyPoolLifecycleOptions(argv.slice(1));
  const args = composeArgsForAction(action);
  const resolvedCompose = requireCompose(compose ?? getCompose?.());
  const result = await resolvedCompose.run(args);
  stdout.write(result?.stdout ?? "");
  stderr.write(result?.stderr ?? "");
  return result;
}

function createProxyPoolLifecycleCommand({
  root,
  stdout = process.stdout,
  stderr = process.stderr,
  compose,
} = {}) {
  let resolvedCompose = compose;

  function getCompose() {
    if (resolvedCompose) {
      return resolvedCompose;
    }
    const {
      createDockerComposeProxyPool,
    } = require("../../proxy/docker_compose_proxy_pool");
    resolvedCompose = createDockerComposeProxyPool({ root });
    return resolvedCompose;
  }

  return (argv = []) => runProxyPoolLifecycleCommand({
    argv,
    getCompose,
    stderr,
    stdout,
  });
}

module.exports = {
  composeArgsForAction,
  createProxyPoolLifecycleCommand,
  parseProxyPoolLifecycleOptions,
  runProxyPoolLifecycleCommand,
};
