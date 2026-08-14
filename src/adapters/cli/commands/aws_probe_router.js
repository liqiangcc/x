"use strict";

const { ProbeAwsRouterUseCase } = require("../../../application/aws/probe_router");
const { parseCliOptions } = require("../option_parser");

function parseAwsProbeRouterOptions(argv, defaults = {}) {
  return parseCliOptions(argv, defaults);
}

async function runAwsProbeRouterCommand({
  argv = [],
  getProbeRouterUseCase,
  probeRouterUseCase,
  stdout = process.stdout,
} = {}) {
  const options = parseAwsProbeRouterOptions(argv);
  if (!options.secid) {
    throw new Error("aws probe-router requires --secid <secid_or_code>.");
  }

  const useCase = probeRouterUseCase ?? getProbeRouterUseCase?.();
  if (!useCase || typeof useCase.execute !== "function") {
    throw new TypeError("probeRouterUseCase must expose execute().");
  }
  const payload = await useCase.execute({
    end: options.end,
    lmt: options.lmt,
    period: options.period,
    secid: options.secid,
    targetRegion: options.targetRegion,
  });
  stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

function createAwsProbeRouterCommand({
  env = process.env,
  fetchImpl = globalThis.fetch,
  probeRouterUseCase,
  routerProbeClient,
  stdout = process.stdout,
} = {}) {
  let resolvedUseCase = probeRouterUseCase;

  function getProbeRouterUseCase() {
    if (!resolvedUseCase) {
      let client = routerProbeClient;
      if (!client) {
        const {
          createHttpRouterProbeClient,
        } = require("../../aws/http_router_probe_client");
        client = createHttpRouterProbeClient({ env, fetchImpl });
      }
      resolvedUseCase = new ProbeAwsRouterUseCase({ routerProbeClient: client });
    }
    return resolvedUseCase;
  }

  return (argv) =>
    runAwsProbeRouterCommand({
      argv,
      getProbeRouterUseCase,
      probeRouterUseCase,
      stdout,
    });
}

module.exports = {
  createAwsProbeRouterCommand,
  parseAwsProbeRouterOptions,
  runAwsProbeRouterCommand,
};
